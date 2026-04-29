import { runActor, getDatasetItems } from '@/lib/apify/client';

export interface SerpResult {
  url: string;
  title: string;
  snippet: string;
  position: number;
  query: string;
}

export async function searchGoogle(queries: string[]): Promise<SerpResult[]> {
  const actorId = process.env.APIFY_GOOGLE_SEARCH_ACTOR_ID || 'apify/google-search-scraper';

  const results: SerpResult[] = [];

  // Run in batches of 5 queries to avoid overloading
  const batchSize = 5;
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);

    const input = {
      queries: batch.join('\n'),
      maxPagesPerQuery: 1,
      resultsPerPage: 5,
      languageCode: 'en',
      mobileResults: false,
      includeUnfilteredResults: false,
    };

    try {
      const { defaultDatasetId } = await runActor(actorId, input, { waitSecs: 120, memory: 4096 });
      const items = await getDatasetItems(defaultDatasetId) as SerpItem[];

      for (const item of items) {
        if (item.organicResults) {
          for (const organic of item.organicResults.slice(0, 5)) {
            if (organic.url && organic.title) {
              results.push({
                url: organic.url,
                title: organic.title,
                snippet: organic.description || '',
                position: organic.position || 0,
                query: item.searchQuery?.term || batch[0],
              });
            }
          }
        }
      }
    } catch (err) {
      console.error(`[GoogleSERP] Batch failed for queries: ${batch.join(', ')}`, err);
    }
  }

  return results;
}

interface SerpItem {
  searchQuery?: { term: string };
  organicResults?: {
    url: string;
    title: string;
    description?: string;
    position?: number;
  }[];
}
