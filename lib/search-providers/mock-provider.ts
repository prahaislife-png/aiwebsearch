import { SearchProvider, SearchResult } from './search-provider';

export class MockSearchProvider implements SearchProvider {
  async search(query: string): Promise<SearchResult[]> {
    console.log(`[MockSearch] Query: ${query}`);
    return [
      {
        title: `Mock result for: ${query}`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        description: `This is a mock search result for development. Configure BRAVE_SEARCH_API_KEY for real results.`,
      },
    ];
  }
}
