import { CaptureProvider, CaptureInput, CaptureResult } from './capture-provider';
import { runActor, getDatasetItems } from '../apify/client';

interface CrawlerItem {
  url?: string;
  loadedUrl?: string;
  screenshotUrl?: string;
  text?: string;
  title?: string;
  metadata?: { title?: string };
}

const BLOCKED_CAPTURE_DOMAINS = [
  'bloomberg.com',
  'linkedin.com',
  'zoominfo.com',
  'dnb.com',
  'mapquest.com',
  'greatplacetowork.com',
  'glassdoor.com',
  'wikipedia.org',
  'crunchbase.com',
  'pitchbook.com',
  'indeed.com',
  'salary.com',
  'ziprecruiter.com',
];

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isBlockedForCapture(url: string): boolean {
  const domain = getDomain(url);
  return BLOCKED_CAPTURE_DOMAINS.some((b) => domain === b || domain.endsWith(`.${b}`));
}

export class ApifyCaptureProvider implements CaptureProvider {
  async capturePages(input: CaptureInput): Promise<CaptureResult[]> {
    const actorId = process.env.APIFY_WEB_SEARCH_ACTOR_ID;
    if (!actorId) throw new Error('APIFY_WEB_SEARCH_ACTOR_ID is not configured');

    const capturableUrls = input.urls.filter((u) => !isBlockedForCapture(u.url));
    const blockedUrls = input.urls.filter((u) => isBlockedForCapture(u.url));

    console.log(`[ApifyCapture] Capturing ${capturableUrls.length} URLs, skipping ${blockedUrls.length} blocked`);

    const results: CaptureResult[] = [];

    // Mark blocked URLs as skipped
    for (const blocked of blockedUrls) {
      results.push({
        sectionKey: blocked.sectionKey,
        sectionTitle: blocked.sectionTitle,
        sourceUrl: blocked.url,
        finalUrl: blocked.url,
        capturedAt: new Date().toISOString(),
        status: 'failed',
        errorMessage: 'Domain blocked for automated capture (use SERP data instead)',
      });
    }

    if (capturableUrls.length === 0) return results;

    const startUrls = capturableUrls.map((u) => ({ url: u.url }));

    const run = await runActor(actorId, {
      startUrls,
      maxCrawlPages: capturableUrls.length,
      crawlerType: 'playwright:firefox',
      includeUrlGlobs: [],
      excludeUrlGlobs: [],
      maxCrawlDepth: 0,
      saveScreenshots: true,
      saveHtml: false,
      removeCookieWarnings: true,
      clickElementsCssSelector:
        '[class*="cookie"] button, [id*="cookie"] button, [class*="consent"] button',
    }, { waitSecs: 300, memory: 4096 });

    const items = (await getDatasetItems(run.defaultDatasetId)) as CrawlerItem[];

    for (const item of items) {
      const matchingInput = capturableUrls.find(
        (u) => u.url === item.url || u.url === item.loadedUrl
      );

      const sectionKey = matchingInput?.sectionKey || 'unknown';
      const sectionTitle = matchingInput?.sectionTitle || 'Unknown';
      const sourceUrl = matchingInput?.url || item.url || '';

      results.push({
        sectionKey,
        sectionTitle,
        sourceUrl,
        finalUrl: item.loadedUrl || item.url || sourceUrl,
        pageTitle: item.metadata?.title || item.title || undefined,
        screenshotUrl: item.screenshotUrl || undefined,
        extractedText: typeof item.text === 'string' ? item.text.substring(0, 5000) : undefined,
        capturedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: undefined,
      });
    }

    // Mark capturable URLs that weren't returned as failed
    for (const urlInput of capturableUrls) {
      const found = results.find((r) => r.sourceUrl === urlInput.url);
      if (!found) {
        results.push({
          sectionKey: urlInput.sectionKey,
          sectionTitle: urlInput.sectionTitle,
          sourceUrl: urlInput.url,
          finalUrl: urlInput.url,
          capturedAt: new Date().toISOString(),
          status: 'failed',
          errorMessage: 'Page was not captured by the crawler',
        });
      }
    }

    return results;
  }
}
