import { CaptureProvider, CaptureInput, CaptureResult } from './capture-provider';
import { getApifyClient } from '../apify/client';

export class ApifyCaptureProvider implements CaptureProvider {
  async capturePages(input: CaptureInput): Promise<CaptureResult[]> {
    const client = getApifyClient();
    const actorId = process.env.APIFY_WEB_SEARCH_ACTOR_ID;
    if (!actorId) throw new Error('APIFY_WEB_SEARCH_ACTOR_ID is not configured');

    const startUrls = input.urls.map((u) => ({ url: u.url }));

    const run = await client.actor(actorId).call(
      {
        startUrls,
        maxCrawlPages: input.urls.length,
        crawlerType: 'playwright:firefox',
        includeUrlGlobs: [],
        excludeUrlGlobs: [],
        maxCrawlDepth: 0,
        saveScreenshots: true,
        saveHtml: false,
        removeCookieWarnings: true,
        clickElementsCssSelector: '[class*="cookie"] button, [id*="cookie"] button, [class*="consent"] button',
      },
      { waitSecs: 300, memory: 4096 } as Record<string, unknown>
    );

    const results: CaptureResult[] = [];
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    interface CrawlerItem {
      url?: string;
      loadedUrl?: string;
      screenshotUrl?: string;
      text?: string;
      title?: string;
      metadata?: { title?: string };
    }

    for (const rawItem of items) {
      const item = rawItem as unknown as CrawlerItem;
      const matchingInput = input.urls.find(
        (u) => u.url === item.url || u.url === item.loadedUrl
      );

      const sectionKey = matchingInput?.sectionKey || 'unknown';
      const sectionTitle = matchingInput?.sectionTitle || 'Unknown';
      const sourceUrl = matchingInput?.url || item.url || '';

      const screenshotUrl = item.screenshotUrl || undefined;

      const extractedText = typeof item.text === 'string'
        ? item.text.substring(0, 5000)
        : undefined;

      results.push({
        sectionKey,
        sectionTitle,
        sourceUrl,
        finalUrl: item.loadedUrl || item.url || sourceUrl,
        pageTitle: item.metadata?.title || item.title || undefined,
        screenshotUrl,
        extractedText,
        capturedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: undefined,
      });
    }

    // Mark URLs that weren't captured as failed
    for (const urlInput of input.urls) {
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
