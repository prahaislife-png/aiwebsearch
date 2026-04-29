import { searchGoogle, SerpResult } from './google-serp-scraper';
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
  reportType: string;
}

export async function discoverCompanySources(
  input: DiscoveryInput
): Promise<SourceCandidate[]> {
  const candidates: SourceCandidate[] = [];
  const maxCapture = MAX_CAPTURE_URLS[input.reportType] || MAX_CAPTURE_URLS['basic'];

  // Detect official domain from provided website
  let officialDomain: string | null = null;
  if (input.officialWebsite) {
    try {
      officialDomain = new URL(input.officialWebsite).hostname.replace(/^www\./, '');
    } catch { /* ignore */ }

    candidates.push({
      sectionKey: 'official_website',
      sectionTitle: 'Official Website / Homepage',
      sourceUrl: input.officialWebsite,
      sourceType: 'user_provided',
      confidence: 'High',
      reason: 'Provided by user',
      shouldCapture: true,
      category: 'official_website',
      priorityScore: 50,
    });
  }

  const queries = buildSearchQueries(input.companyName, input.country, input.reportType);
  console.log(`[SourceDiscovery] Running ${queries.length} search queries...`);

  let serpResults: SerpResult[] = [];
  try {
    serpResults = await searchGoogle(queries);
    console.log(`[SourceDiscovery] Got ${serpResults.length} raw SERP results`);
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

  // Apply relevance filtering
  let accepted = 0;
  let rejected = 0;

  for (const source of classified) {
    if (input.officialWebsite && source.url === input.officialWebsite) continue;

    // Relevance check
    const relevance = isRelevantToCompany(
      { url: source.url, title: source.title, snippet: source.snippet },
      input.companyName,
      officialDomain
    );

    if (!relevance.relevant) {
      rejected++;
      console.log(`[SourceDiscovery] ${relevance.reason}: ${source.url}`);
      continue;
    }

    // Priority scoring
    const priority = calculateSourcePriority(
      { url: source.url, title: source.title, snippet: source.snippet, category: source.category, sectionKey: source.sectionKey },
      input.companyName,
      officialDomain
    );

    if (priority < 20) {
      rejected++;
      console.log(`[SourceDiscovery] SOURCE_REJECTED_LOW_PRIORITY (score ${priority}): ${source.url}`);
      continue;
    }

    accepted++;
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
      priorityScore: priority,
    });
  }

  console.log(`[SourceDiscovery] Accepted: ${accepted}, Rejected: ${rejected}`);

  // Sort by priority and limit capturable URLs
  candidates.sort((a, b) => b.priorityScore - a.priorityScore);

  let captureCount = 0;
  for (const c of candidates) {
    if (c.shouldCapture) {
      captureCount++;
      if (captureCount > maxCapture) {
        c.shouldCapture = false;
        c.sourceType = 'serp_only';
      }
    }
  }

  console.log(`[SourceDiscovery] Final: ${candidates.length} sources, ${candidates.filter(c => c.shouldCapture).length} will be captured (max ${maxCapture})`);

  return candidates;
}
