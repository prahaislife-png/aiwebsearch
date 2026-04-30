import { BraveSearchProvider } from '@/lib/search-providers/brave-provider';
import { analyzeSerpSnippet } from './analyze-evidence';
import { CaptureResult } from '@/lib/browser-capture/capture-provider';

export interface TargetedSearchEvidence {
  sectionKey: string;
  sectionTitle: string;
  sourceUrl: string;
  pageTitle: string;
  snippet: string;
  aiComment: string;
  evidenceBullets: string[];
  confidence: string;
  flags: string[];
  captureStatus: 'search_only';
}

const CORPORATE_GROUP_QUERIES = (name: string) => [
  `"${name}" parent company`,
  `"${name}" corporate group`,
  `"${name}" subsidiaries affiliates`,
  `"${name}" ownership group`,
  `"${name}" acquired by`,
  `"${name}" holding company`,
  `"${name}" Crunchbase`,
  `"${name}" LinkedIn company`,
];

const GOVERNMENT_CONNECTIONS_QUERIES = (name: string, country?: string | null) => {
  const base = [
    `"${name}" government contract`,
    `"${name}" public sector`,
    `"${name}" tender procurement`,
    `"${name}" government client`,
    `"${name}" state owned`,
    `"${name}" grants`,
    `"${name}" official government site`,
    `"${name}" public procurement`,
  ];
  if (country?.toLowerCase().includes('australia')) {
    base.push(`site:gov.au "${name}"`);
  } else if (country?.toLowerCase().includes('united kingdom') || country?.toLowerCase() === 'uk') {
    base.push(`site:gov.uk "${name}"`);
  } else if (country?.toLowerCase().includes('united states') || country?.toLowerCase() === 'us' || country?.toLowerCase() === 'usa') {
    base.push(`site:gov "${name}"`);
  }
  return base;
};

export async function runTargetedSectionSearches(params: {
  companyName: string;
  country?: string | null;
}): Promise<{
  corporate_group: TargetedSearchEvidence[];
  government_connections: TargetedSearchEvidence[];
}> {
  let braveProvider: BraveSearchProvider;
  try {
    braveProvider = new BraveSearchProvider();
  } catch {
    console.warn('[TargetedSearch] Brave Search not configured, skipping targeted searches');
    return { corporate_group: [], government_connections: [] };
  }

  const [groupResults, govResults] = await Promise.all([
    runQueriesForSection({
      queries: CORPORATE_GROUP_QUERIES(params.companyName),
      sectionKey: 'corporate_group',
      sectionTitle: 'Corporate Group Information',
      companyName: params.companyName,
      braveProvider,
      maxResults: 5,
    }),
    runQueriesForSection({
      queries: GOVERNMENT_CONNECTIONS_QUERIES(params.companyName, params.country),
      sectionKey: 'government_connections',
      sectionTitle: 'Government Connections',
      companyName: params.companyName,
      braveProvider,
      maxResults: 5,
    }),
  ]);

  console.log(`[TargetedSearch] Corporate Group: ${groupResults.length} SERP results, Government: ${govResults.length} SERP results`);

  return {
    corporate_group: groupResults,
    government_connections: govResults,
  };
}

async function runQueriesForSection(params: {
  queries: string[];
  sectionKey: string;
  sectionTitle: string;
  companyName: string;
  braveProvider: BraveSearchProvider;
  maxResults: number;
}): Promise<TargetedSearchEvidence[]> {
  const results: TargetedSearchEvidence[] = [];
  const seenUrls = new Set<string>();

  for (const query of params.queries) {
    if (results.length >= params.maxResults) break;

    try {
      const searchResults = await params.braveProvider.search(query, 5);

      for (const sr of searchResults) {
        if (!sr.url || seenUrls.has(sr.url)) continue;
        if (!sr.description || sr.description.length < 20) continue;
        seenUrls.add(sr.url);

        const analysis = await analyzeSerpSnippet({
          sectionKey: params.sectionKey,
          sectionTitle: params.sectionTitle,
          sourceUrl: sr.url,
          title: sr.title,
          snippet: sr.description,
          companyName: params.companyName,
        });

        results.push({
          sectionKey: params.sectionKey,
          sectionTitle: params.sectionTitle,
          sourceUrl: sr.url,
          pageTitle: sr.title,
          snippet: sr.description,
          aiComment: analysis.aiComment,
          evidenceBullets: analysis.evidenceBullets,
          confidence: analysis.confidence,
          flags: analysis.flags,
          captureStatus: 'search_only',
        });

        // Only take top result per query to avoid flooding
        break;
      }
    } catch (err) {
      console.warn(`[TargetedSearch] Query failed: "${query}":`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}

// Returns URLs to attempt screenshot capture for these sections
// (best non-blocked candidates from targeted search results)
export function pickCaptureTargets(
  results: TargetedSearchEvidence[],
  maxCapture: number = 2
): { url: string; sectionKey: string; sectionTitle: string }[] {
  const BLOCKED_DOMAINS = [
    'linkedin.com', 'zoominfo.com', 'bloomberg.com', 'pitchbook.com',
    'glassdoor.com', 'indeed.com', 'salary.com', 'crunchbase.com',
    'owler.com', 'dnb.com', 'hoovers.com',
  ];

  return results
    .filter((r) => {
      const lower = r.sourceUrl.toLowerCase();
      return !BLOCKED_DOMAINS.some((d) => lower.includes(d));
    })
    .slice(0, maxCapture)
    .map((r) => ({ url: r.sourceUrl, sectionKey: r.sectionKey, sectionTitle: r.sectionTitle }));
}
