import { BraveSearchProvider } from '@/lib/search-providers/brave-provider';

const SECTION_LABELS: Record<string, string> = {
  company_identity: 'Company Identity',
  public_registry: 'Public Registry Evidence',
  website_activity: 'Website and Business Activity',
  operational_address: 'Operational Address',
  ownership_management: 'Ownership / Management',
  corporate_group: 'Corporate Group Information',
  government_connections: 'Government Connections',
};

interface GapSearchResult {
  url: string;
  title: string;
  sectionKey: string;
  sectionTitle: string;
}

export async function identifyGapsAndSearch(params: {
  companyName: string;
  country?: string | null;
  coveredSections: Set<string>;
  collectedEvidence: { sectionKey: string; captureStatus: string }[];
}): Promise<GapSearchResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const capturedSections = new Set(
    params.collectedEvidence
      .filter((e) => e.captureStatus === 'captured')
      .map((e) => e.sectionKey)
  );

  const allSections = Object.keys(SECTION_LABELS);
  const missingSections = allSections.filter(
    (s) => !capturedSections.has(s)
  );

  if (missingSections.length === 0) return [];

  const prompt = `You are a research assistant helping verify a company. Your job is to find the BEST external web pages to screenshot as evidence.

Company: "${params.companyName}"
Country: ${params.country || 'Not specified'}

The following verification areas still NEED evidence (no screenshots captured yet):
${missingSections.map((s) => `- ${SECTION_LABELS[s]}`).join('\n')}

Generate 5-8 targeted web search queries to find external pages that show this company's information. Think like a researcher:
- Search company registries for incorporation/registration date (e.g., "VistaVu Solutions" Alberta corporate registry, Companies House, Handelsregister, northdata)
- Search for incorporation date, registration number, HRB, VAT, REA, company number
- Search LinkedIn for the founders/CEO/leadership
- Search news articles mentioning the company
- Search business directories (OpenCorporates, D&B, FirmenWissen, Northdata)
- Search for the company address on Google Maps or business listings
- Search for parent company / group / investors / shareholders
- Search for government contracts, public sector relationships, tenders, procurement

Section-specific guidance:
- For PUBLIC REGISTRY: search for incorporation/registration date, company number, VAT, REA, HRB. Use country-specific registries and credible business-info sites (OpenCorporates, Northdata, D&B, FirmenWissen, Companies House, camera di commercio).
- For CORPORATE GROUP: search for "[company] parent company", "[company] shareholders", "[company] group structure", "[company] acquired by", "[company] holding company", "[company] corporate group".
- For GOVERNMENT CONNECTIONS: search for "[company] government contract", "[company] public sector client", "[company] tender procurement", "[company] public funding EU funding". Note: government OWNERSHIP/CONTROL or direct government CONTRACTS/CLIENTS count.

Rules:
- Include the company name in each query
- Be specific — target pages that will clearly show the information when screenshotted
- Prioritize: registry/incorporation date, ownership/founders, corporate group, government connections, address
- Do NOT search for sanctions, adverse media, or compliance
- Avoid paywalled sites (prefer open registry pages, LinkedIn public profiles, news)

Response format (JSON array):
[
  { "query": "search query", "targetSection": "section_key", "reason": "what we expect to find" },
  { "query": "search query", "targetSection": "section_key", "reason": "what we expect to find" }
]

Valid section keys: ${missingSections.join(', ')}
Return ONLY JSON, no markdown.`;

  try {
    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return [];

    const data = await res.json();
    const text = data.content?.[0]?.type === 'text' ? data.content[0].text : '';
    const queries: { query: string; targetSection: string; reason?: string }[] = JSON.parse(text.trim());

    if (!Array.isArray(queries) || queries.length === 0) return [];

    const braveProvider = new BraveSearchProvider();
    const results: GapSearchResult[] = [];
    const seenUrls = new Set<string>();

    for (const q of queries.slice(0, 8)) {
      const searchResults = await braveProvider.search(q.query, 5);

      for (const sr of searchResults) {
        if (seenUrls.has(sr.url)) continue;
        if (isBlockedForScreenshot(sr.url)) continue;
        seenUrls.add(sr.url);

        results.push({
          url: sr.url,
          title: sr.title,
          sectionKey: q.targetSection,
          sectionTitle: SECTION_LABELS[q.targetSection] || q.targetSection,
        });
        break;
      }

      if (results.length >= 8) break;
    }

    console.log(`[GapSearch] Claude identified ${missingSections.length} gaps, running ${queries.length} searches, found ${results.length} URLs to capture`);
    for (const r of results) {
      console.log(`[GapSearch] → ${r.sectionTitle}: ${r.url}`);
    }
    return results;
  } catch (err) {
    console.error('[GapSearch] Failed:', err);
    return [];
  }
}

function isBlockedForScreenshot(url: string): boolean {
  const blocked = [
    'linkedin.com/in/',
    'linkedin.com/company/',
    'zoominfo.com',
    'bloomberg.com',
    'pitchbook.com',
    'glassdoor.com',
    'indeed.com',
    'salary.com',
  ];
  const lower = url.toLowerCase();
  return blocked.some((b) => lower.includes(b));
}
