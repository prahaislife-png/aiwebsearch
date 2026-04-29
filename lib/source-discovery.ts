import { SearchProvider } from './search-providers/search-provider';
import { BraveSearchProvider } from './search-providers/brave-provider';
import { MockSearchProvider } from './search-providers/mock-provider';

export interface SourceCandidate {
  sectionKey: string;
  sectionTitle: string;
  sourceUrl: string;
  sourceType: string;
  confidence: string;
  reason: string;
}

interface DiscoveryInput {
  companyName: string;
  country?: string | null;
  officialWebsite?: string | null;
  reportType: string;
}

interface SectionConfig {
  key: string;
  title: string;
  queries: (input: DiscoveryInput) => string[];
  enhancedOnly?: boolean;
}

const SECTIONS: SectionConfig[] = [
  {
    key: 'official_website',
    title: 'Official Website / Homepage',
    queries: (input) => {
      if (input.officialWebsite) return [];
      return [`${input.companyName} official website`];
    },
  },
  {
    key: 'about_company',
    title: 'About / Activity / Products / Services',
    queries: (input) => [
      `${input.companyName} about`,
      `${input.companyName} services products`,
    ],
  },
  {
    key: 'contact_location',
    title: 'Contact / Location / Operational Address',
    queries: (input) => [
      `${input.companyName} contact address`,
      ...(input.officialWebsite
        ? [`site:${new URL(input.officialWebsite).hostname} contact`]
        : []),
    ],
  },
  {
    key: 'public_registry',
    title: 'Corporate Registry / Public Record',
    queries: (input) => [
      `${input.companyName} company registry ${input.country || ''}`.trim(),
      `${input.companyName} business registration ${input.country || ''}`.trim(),
    ],
  },
  {
    key: 'management_history',
    title: 'History / Founder / Management / Ownership',
    queries: (input) => [
      `${input.companyName} founder management`,
      `${input.companyName} leadership history`,
    ],
  },
  {
    key: 'group_shareholding',
    title: 'Corporate Group / Parent / Shareholding / Government Connection',
    enhancedOnly: true,
    queries: (input) => [
      `${input.companyName} parent company shareholders`,
      `${input.companyName} ownership structure investors`,
      `${input.companyName} government ownership contract`,
    ],
  },
];

function getSearchProvider(): SearchProvider {
  if (process.env.BRAVE_SEARCH_API_KEY) {
    return new BraveSearchProvider();
  }
  console.warn('[SourceDiscovery] No search API key configured, using mock provider');
  return new MockSearchProvider();
}

export async function discoverCompanySources(
  input: DiscoveryInput
): Promise<SourceCandidate[]> {
  const provider = getSearchProvider();
  const candidates: SourceCandidate[] = [];
  const seenUrls = new Set<string>();

  // If official website provided, add it directly
  if (input.officialWebsite) {
    candidates.push({
      sectionKey: 'official_website',
      sectionTitle: 'Official Website / Homepage',
      sourceUrl: input.officialWebsite,
      sourceType: 'user_provided',
      confidence: 'High',
      reason: 'Provided by user',
    });
    seenUrls.add(input.officialWebsite);
  }

  const activeSections = SECTIONS.filter(
    (s) => !s.enhancedOnly || input.reportType === 'enhanced'
  );

  for (const section of activeSections) {
    const queries = section.queries(input);
    if (queries.length === 0 && section.key === 'official_website' && input.officialWebsite) {
      continue;
    }

    for (const query of queries) {
      try {
        const results = await provider.search(query, 3);
        for (const result of results) {
          if (seenUrls.has(result.url)) continue;
          seenUrls.add(result.url);

          candidates.push({
            sectionKey: section.key,
            sectionTitle: section.title,
            sourceUrl: result.url,
            sourceType: 'search',
            confidence: 'Medium',
            reason: `Found via search: "${query}"`,
          });
          break; // Take top result per query
        }
      } catch (err) {
        console.error(`[SourceDiscovery] Search failed for "${query}":`, err);
      }
    }
  }

  return candidates;
}
