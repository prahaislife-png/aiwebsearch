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
  'ownership_unclear',
  'management_found',
  'parent_company_found',
  'government_connection_mentioned',
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
      evidenceBullets: ['Analysis skipped due to missing configuration.'],
      confidence: 'Low',
      flags: ['manual_review_needed'],
    };
  }

  const prompt = `You are an evidence analyst reviewing a web page captured during a company research report.

Company being researched: "${params.companyName}"
Section: "${params.sectionTitle}"
Source URL: ${params.sourceUrl}
Page title: ${params.pageTitle || 'Unknown'}

Extracted page text (truncated):
---
${params.extractedText?.substring(0, 3000) || 'No text extracted from this page.'}
---

Based on this source, analyze:
1. What does this page indicate about the company?
2. Does it identify company activity, products, or services?
3. Does it show an address or contact information?
4. Does it show corporate registration or registry information?
5. Does it mention management, founders, or leadership?
6. Does it mention parent company, shareholding, or government connection?
7. Are there items needing manual review?

RULES:
- Do NOT invent facts not present in the text.
- Do NOT say "verified" unless the page clearly supports it.
- Use cautious language: "appears to show", "indicates", "mentions", "no clear evidence found".
- Every statement must be grounded in the source URL or extracted text.

Respond in this exact JSON format:
{
  "aiComment": "A short paragraph (2-4 sentences) summarizing what this source shows.",
  "evidenceBullets": ["bullet 1", "bullet 2", "bullet 3"],
  "confidence": "High" | "Medium" | "Low",
  "flags": ["flag1", "flag2"]
}

Allowed flags: ${ALLOWED_FLAGS.join(', ')}

Return ONLY the JSON, no markdown wrapping.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
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
    const text =
      data.content?.[0]?.type === 'text' ? data.content[0].text : '';
    const parsed = JSON.parse(text.trim());

    return {
      aiComment: parsed.aiComment || 'Analysis completed.',
      evidenceBullets: Array.isArray(parsed.evidenceBullets)
        ? parsed.evidenceBullets.slice(0, 4)
        : [],
      confidence: ['High', 'Medium', 'Low'].includes(parsed.confidence)
        ? parsed.confidence
        : 'Medium',
      flags: Array.isArray(parsed.flags)
        ? parsed.flags.filter((f: string) => ALLOWED_FLAGS.includes(f))
        : [],
    };
  } catch (err) {
    console.error('[EvidenceAnalyzer] Analysis failed:', err);
    return {
      aiComment: 'AI analysis could not be completed for this source.',
      evidenceBullets: ['Automated analysis encountered an error.'],
      confidence: 'Low',
      flags: ['manual_review_needed'],
    };
  }
}
