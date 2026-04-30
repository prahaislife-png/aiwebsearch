export interface SectionResult {
  status: string;
  confidence: string;
  sourceUrls: string[];
  screenshotUrls: string[];
  snippet: string;
  findings: string[];
  flags: string[];
  conclusion: string;
}

export interface StructuredReport {
  sections: {
    companyIdentity: SectionResult;
    publicRegistry: SectionResult;
    websiteActivity: SectionResult;
    operationalAddress: SectionResult;
    ownershipManagement: SectionResult;
    corporateGroup: SectionResult;
    governmentConnections: SectionResult;
  };
  finalAssessment: string;
}

interface CollectedEvidence {
  sectionKey: string;
  sectionTitle: string;
  sourceUrl: string;
  pageTitle?: string;
  screenshotUrl?: string;
  extractedText?: string;
  snippet?: string;
  captureStatus: string;
  aiComment?: string;
  evidenceBullets?: string[];
  confidence?: string;
  flags?: string[];
}

export async function generateStructuredReport(params: {
  companyName: string;
  country?: string | null;
  officialWebsite?: string | null;
  evidence: CollectedEvidence[];
}): Promise<StructuredReport | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const evidenceSummary = params.evidence.map((e) => ({
    section: e.sectionTitle,
    url: e.sourceUrl,
    status: e.captureStatus,
    title: e.pageTitle || '',
    comment: e.aiComment || '',
    bullets: e.evidenceBullets || [],
    flags: e.flags || [],
    snippet: (e.extractedText || e.snippet || '').substring(0, 500),
  }));

  const prompt = `You are generating a structured company verification report.

Company: "${params.companyName}"
Country: ${params.country || 'Not specified'}
Official Website: ${params.officialWebsite || 'Not provided'}

Collected evidence:
${JSON.stringify(evidenceSummary, null, 2)}

Generate a structured report covering these 7 areas:
1. Company Identity - Does the company exist? Can its legal identity be confirmed?
2. Public Registry Evidence - Is there public registry/incorporation evidence?
3. Website and Business Activity - What does the company do?
4. Operational Address - Where is the company located?
5. Ownership / Management - Who owns/runs the company?
6. Corporate Group Information - Is it part of a larger group?
7. Government Connections - Is there government ownership or control?

RULES:
- Base conclusions ONLY on the evidence provided.
- Status must be: "Found", "Partial", "Not found", or "Not publicly available"
- If user provided an official website, Company Identity status = "Found" unless evidence contradicts.
- Government Connections: ONLY government ownership/control. "Public sector clients" does NOT mean government owned.
- Corporate Group: ONLY mark as "Found" if evidence explicitly shows parent company, subsidiary, holding company, group structure, shareholders, beneficial owners, PSC, or ownership chain. Directors/officers alone do NOT prove corporate group. A Companies House page existing does NOT prove corporate group. If no real group evidence exists, status = "Not found" or "Not publicly available".
- Do NOT add sanctions, adverse media, or compliance checks.
- Do NOT use contradictory flags (e.g., address_found AND address_not_found).
- Keep conclusions brief (1-2 sentences per section).

Return JSON:
{
  "sections": {
    "companyIdentity": { "status": "...", "confidence": "High|Medium|Low", "sourceUrls": [...], "screenshotUrls": [...], "snippet": "key text excerpt", "findings": [...], "flags": [...], "conclusion": "..." },
    "publicRegistry": { ... },
    "websiteActivity": { ... },
    "operationalAddress": { ... },
    "ownershipManagement": { ... },
    "corporateGroup": { ... },
    "governmentConnections": { ... }
  },
  "finalAssessment": "Overall 2-3 sentence assessment of the company's verifiability."
}

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
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.type === 'text' ? data.content[0].text : '';
    const parsed = JSON.parse(text.trim());

    return parsed as StructuredReport;
  } catch (err) {
    console.error('[GenerateReport] Structured report generation failed:', err);
    return null;
  }
}
