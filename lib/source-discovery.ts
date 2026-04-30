import { BraveSearchProvider } from './search-providers/brave-provider';
import { buildSearchQueries, MAX_CAPTURE_URLS } from './search-pipeline';
import { classifyAndPrepare, ClassifiedSource } from './classify-sources';
import { isRelevantToCompany, calculateSourcePriority } from './relevance';

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
  priorityScore: number;
}

interface DiscoveryInput {
  companyName: string;
  country?: string | null;
  officialWebsite?: string | null;
}

export async function discoverCompanySources(
  input: DiscoveryInput
): Promise<SourceCandidate[]> {
  const candidates: SourceCandidate[] = [];

  let officialDomain: string | null = null;
  if (input.officialWebsite) {
    try {
      officialDomain = new URL(input.officialWebsite).hostname.replace(/^www\./, '');
    } catch { /* ignore */ }

    candidates.push({
      sectionKey: 'company_identity',
      sectionTitle: 'Company Identity',
      sourceUrl: input.officialWebsite,
      sourceType: 'user_provided',
      confidence: 'High',
      reason: 'Official website provided by user',
      shouldCapture: true,
      category: 'company_identity',
      priorityScore: 50,
    });
  }

  const queries = buildSearchQueries(input.companyName, input.country, input.officialWebsite);
  console.log(`[SourceDiscovery] Running ${queries.length} Brave searches...`);

  const brave = new BraveSearchProvider();
  const allResults: { url: string; title: string; snippet: string }[] = [];

  for (const query of queries) {
    try {
      const results = await brave.search(query, 5);
      for (const r of results) {
        allResults.push({ url: r.url, title: r.title, snippet: r.description });
      }
    } catch (err) {
      console.error(`[SourceDiscovery] Brave search failed for "${query}":`, err);
    }
  }

  console.log(`[SourceDiscovery] Got ${allResults.length} raw Brave results`);

  const classified: ClassifiedSource[] = classifyAndPrepare(
    allResults,
    input.companyName,
    input.country
  );

  console.log(`[SourceDiscovery] After classification & dedup: ${classified.length} unique sources`);

  let accepted = 0;
  let rejected = 0;

  for (const source of classified) {
    if (input.officialWebsite && source.url === input.officialWebsite) continue;

    const relevance = isRelevantToCompany(
      { url: source.url, title: source.title, snippet: source.snippet },
      input.companyName,
      officialDomain
    );

    if (!relevance.relevant) {
      rejected++;
      console.log(`[SourceDiscovery] REJECTED: ${relevance.reason} -> ${source.url}`);
      continue;
    }

    const priority = calculateSourcePriority(
      { url: source.url, title: source.title, snippet: source.snippet, category: source.category, sectionKey: source.sectionKey },
      input.companyName,
      officialDomain
    );

    if (priority < 10) {
      rejected++;
      console.log(`[SourceDiscovery] LOW_PRIORITY (${priority}): ${source.url}`);
      continue;
    }

    accepted++;
    candidates.push({
      sectionKey: source.sectionKey,
      sectionTitle: source.sectionTitle,
      sourceUrl: source.url,
      sourceType: source.shouldCapture ? 'search' : 'serp_only',
      confidence: source.shouldCapture ? 'Medium' : 'Low',
      reason: `Brave Search: ${source.title}`,
      snippet: source.snippet,
      shouldCapture: source.shouldCapture,
      category: source.category,
      priorityScore: priority,
    });
  }

  console.log(`[SourceDiscovery] Accepted: ${accepted}, Rejected: ${rejected}`);

  // Sort by priority and cap capturable URLs
  candidates.sort((a, b) => b.priorityScore - a.priorityScore);

  let captureCount = 0;
  for (const c of candidates) {
    if (c.shouldCapture) {
      captureCount++;
      if (captureCount > MAX_CAPTURE_URLS) {
        c.shouldCapture = false;
        c.sourceType = 'serp_only';
      }
    }
  }

  console.log(`[SourceDiscovery] Final: ${candidates.length} sources, ${candidates.filter(c => c.shouldCapture).length} capturable`);
  return candidates;
}
