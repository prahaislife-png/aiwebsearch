import { SearchProvider, SearchResult } from './search-provider';

export class BraveSearchProvider implements SearchProvider {
  private apiKey: string;

  constructor() {
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key) throw new Error('BRAVE_SEARCH_API_KEY is not configured');
    this.apiKey = key;
  }

  async search(query: string, count: number = 5): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
    });

    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey,
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Brave Search API error (${res.status}): ${text}`);
    }

    const data = await res.json();
    const results: SearchResult[] = (data.web?.results || []).map(
      (r: { title: string; url: string; description: string }) => ({
        title: r.title || '',
        url: r.url || '',
        description: r.description || '',
      })
    );

    return results;
  }
}
