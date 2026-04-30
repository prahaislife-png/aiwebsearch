import { CaptureResult } from '../browser-capture/capture-provider';
import { runActor, getDatasetItems } from './client';

interface CrawlerPage {
  url?: string;
  loadedUrl?: string;
  title?: string;
  text?: string;
  markdown?: string;
  metadata?: { title?: string };
}

const PATH_TO_SECTION: Record<string, { key: string; title: string }> = {
  contact: { key: 'operational_address', title: 'Operational Address' },
  locations: { key: 'operational_address', title: 'Operational Address' },
  offices: { key: 'operational_address', title: 'Operational Address' },
  about: { key: 'website_activity', title: 'Website and Business Activity' },
  'about-us': { key: 'website_activity', title: 'Website and Business Activity' },
  services: { key: 'website_activity', title: 'Website and Business Activity' },
  solutions: { key: 'website_activity', title: 'Website and Business Activity' },
  products: { key: 'website_activity', title: 'Website and Business Activity' },
  team: { key: 'ownership_management', title: 'Ownership / Management' },
  leadership: { key: 'ownership_management', title: 'Ownership / Management' },
  management: { key: 'ownership_management', title: 'Ownership / Management' },
  imprint: { key: 'company_identity', title: 'Company Identity' },
  impressum: { key: 'company_identity', title: 'Company Identity' },
  legal: { key: 'company_identity', title: 'Company Identity' },
  privacy: { key: 'company_identity', title: 'Company Identity' },
};

function classifyUrl(url: string): { key: string; title: string } {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const segments = pathname.split('/').filter(Boolean);
    for (const segment of segments) {
      const match = PATH_TO_SECTION[segment];
      if (match) return match;
    }
    for (const [keyword, section] of Object.entries(PATH_TO_SECTION)) {
      if (pathname.includes(keyword)) return section;
    }
  } catch { /* ignore */ }
  return { key: 'website_activity', title: 'Website and Business Activity' };
}

export async function enrichWithWebsiteCrawler(params: {
  officialWebsite: string;
  companyName: string;
  jobId: string;
  alreadyCapturedUrls: Set<string>;
}): Promise<CaptureResult[]> {
  const actorId = process.env.APIFY_WEBSITE_CRAWLER_ACTOR_ID;
  if (!actorId) return [];

  console.log(`[ApifyCrawler] Crawling official website: ${params.officialWebsite}`);

  const run = await runActor(actorId, {
    startUrls: [{ url: params.officialWebsite }],
    maxCrawlPages: 10,
    crawlerType: 'playwright:adaptive',
    maxCrawlDepth: 1,
    includeUrlGlobs: [],
    excludeUrlGlobs: ['/**/*.pdf', '/**/*.zip', '/**/*.png', '/**/*.jpg'],
    saveMarkdown: true,
    saveHtml: false,
    removeCookieWarnings: true,
  }, { waitSecs: 180, memory: 2048 });

  const items = (await getDatasetItems(run.defaultDatasetId)) as CrawlerPage[];

  if (!items || items.length === 0) {
    console.log('[ApifyCrawler] No pages crawled');
    return [];
  }

  console.log(`[ApifyCrawler] Crawled ${items.length} pages`);

  const results: CaptureResult[] = [];

  for (const item of items) {
    const pageUrl = item.loadedUrl || item.url || '';
    if (!pageUrl) continue;

    if (params.alreadyCapturedUrls.has(pageUrl)) continue;

    const text = item.markdown || item.text || '';
    if (!text || text.length < 100) continue;

    const section = classifyUrl(pageUrl);
    const pageTitle = item.metadata?.title || item.title || '';

    results.push({
      sectionKey: section.key,
      sectionTitle: section.title,
      sourceUrl: pageUrl,
      finalUrl: pageUrl,
      pageTitle: pageTitle || undefined,
      extractedText: text.substring(0, 5000),
      capturedAt: new Date().toISOString(),
      status: 'success',
    });
  }

  console.log(`[ApifyCrawler] Returning ${results.length} new pages (after dedup)`);
  return results;
}
