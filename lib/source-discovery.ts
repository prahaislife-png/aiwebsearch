import { searchGoogle, SerpResult } from './google-serp-scraper';
import { buildSearchQueries } from './search-pipeline';
import { classifyAndPrepare, ClassifiedSource } from './classify-sources';

export interface SourceCandidate {
  sectionKey: string;
  sectionTitle: string;
  sourceUrl: string;
  sourceType: string;
  confidence: string;
  reason: string;
  snippet?: string;
  shouldCapture: boolean;
  category: string;
}

interface DiscoveryInput {
  companyName: string;
  country?: string | null;
  officialWebsite?: string | null;
  reportType: string;
}

export async function discoverCompanySources(
  input: DiscoveryInput
): Promise<SourceCandidate[]> {
  const candidates: SourceCandidate[] = [];

  if (input.officialWebsite) {
    candidates.push({
      sectionKey: 'official_website',
      sectionTitle: 'Official Website / Homepage',
      sourceUrl: input.officialWebsite,
      sourceType: 'user_provided',
      confidence: 'High',
      reason: 'Provided by user',
      shouldCapture: true,
      category: 'official_website',
    });
  }

  const queries = buildSearchQueries(input.companyName, input.country, input.reportType);
  console.log(`[SourceDiscovery] Running ${queries.length} search queries...`);

  let serpResults: SerpResult[] = [];
  try {
    serpResults = await searchGoogle(queries);
    console.log(`[SourceDiscovery] Got ${serpResults.length} SERP results`);
  } catch (err) {
    console.error('[SourceDiscovery] Google SERP failed:', err);
    return candidates;
  }

  const classified: ClassifiedSource[] = classifyAndPrepare(
    serpResults.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet })),
    input.companyName,
    input.country
  );

  console.log(`[SourceDiscovery] After classification & dedup: ${classified.length} unique sources`);

  for (const source of classified) {
    if (input.officialWebsite && source.url === input.officialWebsite) continue;

    candidates.push({
      sectionKey: source.sectionKey,
      sectionTitle: source.sectionTitle,
      sourceUrl: source.url,
      sourceType: source.shouldCapture ? 'search' : 'serp_only',
      confidence: source.shouldCapture ? 'Medium' : 'Low',
      reason: `Google SERP: ${source.title}`,
      snippet: source.snippet,
      shouldCapture: source.shouldCapture,
      category: source.category,
    });
  }

  return candidates;
}
