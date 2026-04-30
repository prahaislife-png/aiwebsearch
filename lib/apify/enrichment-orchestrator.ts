import { CaptureResult } from '../browser-capture/capture-provider';
import { enrichWithGoogleMaps } from './google-maps-enrichment';
import { enrichWithLinkedIn } from './linkedin-enrichment';
import { enrichWithWebsiteCrawler } from './website-crawler-enrichment';

export async function runApifyEnrichment(params: {
  companyName: string;
  country?: string | null;
  officialWebsite?: string | null;
  jobId: string;
  alreadyCapturedUrls: Set<string>;
}): Promise<CaptureResult[]> {
  if (process.env.ENABLE_APIFY_ENRICHMENT !== 'true') return [];
  if (!process.env.APIFY_TOKEN) return [];

  console.log(`[ApifyEnrichment] Starting parallel enrichment for "${params.companyName}"`);

  const tasks: Promise<CaptureResult | CaptureResult[] | null>[] = [
    enrichWithGoogleMaps({
      companyName: params.companyName,
      country: params.country,
      jobId: params.jobId,
    }).catch((err) => {
      console.error('[ApifyEnrichment] Google Maps failed:', err.message);
      return null;
    }),

    enrichWithLinkedIn({
      companyName: params.companyName,
      country: params.country,
      jobId: params.jobId,
    }).catch((err) => {
      console.error('[ApifyEnrichment] LinkedIn failed:', err.message);
      return null;
    }),
  ];

  if (params.officialWebsite) {
    tasks.push(
      enrichWithWebsiteCrawler({
        officialWebsite: params.officialWebsite,
        companyName: params.companyName,
        jobId: params.jobId,
        alreadyCapturedUrls: params.alreadyCapturedUrls,
      }).catch((err) => {
        console.error('[ApifyEnrichment] Website Crawler failed:', err.message);
        return [] as CaptureResult[];
      })
    );
  }

  const settled = await Promise.allSettled(tasks);

  const results: CaptureResult[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) {
      if (Array.isArray(result.value)) {
        results.push(...result.value);
      } else {
        results.push(result.value);
      }
    }
  }

  console.log(`[ApifyEnrichment] Completed: ${results.length} enrichment results`);
  return results;
}
