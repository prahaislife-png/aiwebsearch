export interface EvidenceAnalysis {
  aiComment: string;
  evidenceBullets: string[];
  confidence: 'High' | 'Medium' | 'Low';
  flags: string[];
}

const ALLOWED_FLAGS = [
  'website_identified',
  'company_activity_found',
  'operational_address_found',
  'registry_found',
  'registry_not_found',
  'address_not_found',
  'ownership_found',
  'ownership_unclear',
  'management_found',
  'parent_company_found',
  'government_connection_found',
  'possible_pobox',
  'source_blocked',
  'manual_review_needed',
  'no_issue_found',
];

export async function analyzeEvidence(params: {
  sectionKey: string;
  sectionTitle: string;
  sourceUrl: string;
  pageTitle?: string;
  extractedText?: string;
  companyName: string;
}): Promise<EvidenceAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      aiComment: 'AI analysis unavailable - API key not configured.',
      evidenceBullets: ['Analysis skipped.'],
      confidence: 'Low',
      flags: ['manual_review_needed'],
    };
  }

  const prompt = `You are analyzing a web page captured during a company verification report.

Company: "${params.companyName}"
Section: "${params.sectionTitle}"
Source URL: ${params.sourceUrl}
Page title: ${params.pageTitle || 'Unknown'}

Extracted text (truncated):
---
${params.extractedText?.substring(0, 4000) || 'No text extracted.'}
---

Analyze this source for the following (only report what is actually present):
1. Company identity confirmation (name, legal form, domain)
2. Public registry / registration details (registration number, HRB, jurisdiction, incorporation date, company status)
3. Business activity (services, products, industry)
4. Operational address (street, city, state, country, phone, email)
5. Ownership / management (founder, CEO, directors, board members)
6. Corporate group (parent company, subsidiaries, affiliates)
7. Government connections (government ownership or control ONLY — not "sells to government")
8. Brand name vs legal entity name (note if the legal name differs from the website brand name)

RULES:
- Only state facts directly present in the text.
- Use cautious language: "indicates", "mentions", "appears to show".
- Extract specific facts: names, addresses, registration numbers, dates.
- Do NOT invent information.
- CRITICAL for registry_found: Only use this flag if the page text clearly shows registration details FOR THE TARGET COMPANY "${params.companyName}". If the page shows a different company's registry info, set confidence to Low and note the mismatch.
- If you detect a brand name that differs from the legal entity name (e.g., brand "Walldorf Consulting" vs legal entity "WCA Walldorf Consulting GmbH"), include both in findings.

Respond in JSON:
{
  "aiComment": "2-4 sentence summary of findings.",
  "evidenceBullets": ["finding 1", "finding 2", ...],
  "confidence": "High" | "Medium" | "Low",
  "flags": ["flag1", ...]
}

Allowed flags: ${ALLOWED_FLAGS.join(', ')}

Flag rules:
- Use operational_address_found if ANY address/location is present
- Use management_found if ANY leadership/founder/CEO name is found
- Use registry_found if the page contains SPECIFIC company registration data for the target company: VAT/tax ID, registration number, HRB, REA, company number, incorporation/founded date, share capital, registry court, chamber of commerce entry, legal form/company type. This applies REGARDLESS of which section this page belongs to (e.g., an Impressum showing VAT and REA should set registry_found).
- Use government_connection_found for: government ownership/control, government contracts/tenders won, public sector client relationships explicitly stated, public procurement awards, EU/government funding received. Do NOT use for: company sells software to general market that may include some government users.
- Use parent_company_found ONLY if text explicitly mentions: parent company, subsidiary, holding company, group structure, ultimate owner, beneficial owner, shareholders, PSC/person with significant control, or ownership chain. Do NOT use this flag just because a company registry page exists or directors/officers are listed — those are management_found, not parent_company_found.

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

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.type === 'text' ? data.content[0].text : '';
    const parsed = JSON.parse(text.trim());

    const flags = Array.isArray(parsed.flags)
      ? parsed.flags.filter((f: string) => ALLOWED_FLAGS.includes(f))
      : [];

    // Contradictory flag cleanup
    if (flags.includes('operational_address_found')) {
      const idx = flags.indexOf('address_not_found');
      if (idx !== -1) flags.splice(idx, 1);
    }
    if (flags.includes('registry_found')) {
      const idx = flags.indexOf('registry_not_found');
      if (idx !== -1) flags.splice(idx, 1);
    }
    if (flags.includes('ownership_found')) {
      const idx = flags.indexOf('ownership_unclear');
      if (idx !== -1) flags.splice(idx, 1);
    }

    // Validate parent_company_found — only keep if text contains real group terms
    if (flags.includes('parent_company_found')) {
      const text = (params.extractedText || '').toLowerCase();
      const groupTerms = ['parent company', 'subsidiary', 'holding company', 'group structure',
        'ultimate owner', 'beneficial owner', 'shareholder', 'person with significant control',
        'psc', 'ownership chain', 'wholly owned', 'group of companies', 'affiliate'];
      const hasGroupEvidence = groupTerms.some((term) => text.includes(term));
      if (!hasGroupEvidence) {
        const idx = flags.indexOf('parent_company_found');
        flags.splice(idx, 1);
      }
    }

    return {
      aiComment: parsed.aiComment || 'Analysis completed.',
      evidenceBullets: Array.isArray(parsed.evidenceBullets) ? parsed.evidenceBullets.slice(0, 6) : [],
      confidence: ['High', 'Medium', 'Low'].includes(parsed.confidence) ? parsed.confidence : 'Medium',
      flags,
    };
  } catch (err) {
    console.error('[EvidenceAnalyzer] Analysis failed:', err);
    return {
      aiComment: 'AI analysis could not be completed.',
      evidenceBullets: ['Analysis error.'],
      confidence: 'Low',
      flags: ['manual_review_needed'],
    };
  }
}

export async function analyzeSerpSnippet(params: {
  sectionKey: string;
  sectionTitle: string;
  sourceUrl: string;
  title: string;
  snippet: string;
  companyName: string;
}): Promise<EvidenceAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      aiComment: `Search result: ${params.title}. ${params.snippet}`,
      evidenceBullets: [params.snippet].filter(Boolean),
      confidence: 'Low',
      flags: ['source_blocked'],
    };
  }

  const prompt = `Analyze this search result snippet for a company verification report. The full page was not captured.

Company: "${params.companyName}"
Section: "${params.sectionTitle}"
URL: ${params.sourceUrl}
Title: ${params.title}
Snippet: ${params.snippet}

Extract only facts directly present in the snippet about:
- Company identity, address, registration, management, group structure, government ownership

RULES:
- Only state facts in the snippet. Do NOT infer.
- Confidence must be "Low" (snippet only).
- 1-2 sentence aiComment.

JSON response:
{
  "aiComment": "...",
  "evidenceBullets": ["..."],
  "confidence": "Low",
  "flags": ["..."]
}

Allowed flags: ${ALLOWED_FLAGS.join(', ')}
Return ONLY JSON.`;

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
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`API error (${res.status})`);

    const data = await res.json();
    const text = data.content?.[0]?.type === 'text' ? data.content[0].text : '';
    const parsed = JSON.parse(text.trim());

    return {
      aiComment: parsed.aiComment || `Search snippet: ${params.title}`,
      evidenceBullets: Array.isArray(parsed.evidenceBullets) ? parsed.evidenceBullets.slice(0, 4) : [params.snippet],
      confidence: 'Low',
      flags: Array.isArray(parsed.flags) ? parsed.flags.filter((f: string) => ALLOWED_FLAGS.includes(f)) : ['source_blocked'],
    };
  } catch {
    return {
      aiComment: `Search result: ${params.title}. ${params.snippet}`,
      evidenceBullets: [params.snippet].filter(Boolean),
      confidence: 'Low',
      flags: ['source_blocked'],
    };
  }
}
