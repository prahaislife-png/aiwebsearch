export interface RelevanceResult {
  relevant: boolean;
  score: number;
  reason: string;
}

const HIGH_VALUE_DOMAINS = [
  'linkedin.com',
  'zoominfo.com',
  'dnb.com',
  'bloomberg.com',
  'crunchbase.com',
  'cbinsights.com',
  'tracxn.com',
  'pitchbook.com',
  'prnewswire.com',
  'businesswire.com',
  'globenewswire.com',
];

const JUNK_DOMAINS = [
  'scribd.com',
  'issuu.com',
  'reddit.com',
  'waru.edu',
  'mapquest.com',
  'glassdoor.com',
  'salary.com',
  'ziprecruiter.com',
  'indeed.com',
  'greatplacetowork.com',
];

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function generateAliases(companyName: string): string[] {
  const aliases: string[] = [];
  const name = companyName.trim();

  aliases.push(name.toLowerCase());

  const withoutSuffix = name
    .replace(/\b(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|plc\.?|corporation|incorporated|limited)\b/gi, '')
    .trim();
  if (withoutSuffix.toLowerCase() !== name.toLowerCase()) {
    aliases.push(withoutSuffix.toLowerCase());
  }

  const words = withoutSuffix.split(/\s+/).filter((w) => w.length > 2);
  if (words.length >= 2) {
    aliases.push(words.join('').toLowerCase());
    aliases.push(words.join('-').toLowerCase());
  }

  return [...new Set(aliases)];
}

function textContainsCompany(text: string, companyName: string, aliases: string[]): boolean {
  const lower = text.toLowerCase();
  for (const alias of aliases) {
    if (lower.includes(alias)) return true;
  }
  return false;
}

function domainBelongsToCompany(url: string, companyName: string, aliases: string[]): boolean {
  const domain = getDomain(url);
  for (const alias of aliases) {
    const cleaned = alias.replace(/[^a-z0-9]/g, '');
    if (cleaned.length >= 4 && domain.includes(cleaned)) return true;
  }
  return false;
}

export function isRelevantToCompany(
  source: {
    url: string;
    title: string;
    snippet: string;
    extractedText?: string;
  },
  companyName: string,
  officialDomain?: string | null
): RelevanceResult {
  const aliases = generateAliases(companyName);

  if (officialDomain) {
    const cleanDomain = officialDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    aliases.push(cleanDomain.toLowerCase());
  }

  const domain = getDomain(source.url);

  // Immediate rejection: extracted text says company not mentioned
  if (source.extractedText) {
    const textLower = source.extractedText.toLowerCase();
    const notMentionedPatterns = [
      `no mention of ${companyName.toLowerCase()}`,
      `does not contain.*${aliases[0]}`,
      'target company is not mentioned',
      'company was not mentioned',
      'not mentioned anywhere',
      'does not contain information about the target',
    ];
    for (const pattern of notMentionedPatterns) {
      if (textLower.includes(pattern) || new RegExp(pattern, 'i').test(textLower)) {
        return { relevant: false, score: -100, reason: 'SOURCE_REJECTED_IRRELEVANT: text confirms company not mentioned' };
      }
    }
  }

  // Check if domain is official company domain
  if (officialDomain && domain === getDomain(officialDomain)) {
    return { relevant: true, score: 40, reason: 'Official company domain' };
  }

  // Check if URL domain clearly belongs to company
  if (domainBelongsToCompany(source.url, companyName, aliases)) {
    return { relevant: true, score: 40, reason: 'Domain matches company name' };
  }

  // Check title and snippet for company name
  const titleSnippet = `${source.title} ${source.snippet}`;
  const titleSnippetRelevant = textContainsCompany(titleSnippet, companyName, aliases);

  // Check extracted text for company name
  const extractedRelevant = source.extractedText
    ? textContainsCompany(source.extractedText, companyName, aliases)
    : false;

  // High-value domain with company name in snippet
  const isHighValue = HIGH_VALUE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
  if (isHighValue && titleSnippetRelevant) {
    return { relevant: true, score: 25, reason: 'Credible business database with company name in snippet' };
  }

  // Gov domain (registry/court)
  const isGov = domain.endsWith('.gov') || domain.endsWith('.gov.uk');
  if (isGov && titleSnippetRelevant) {
    return { relevant: true, score: 30, reason: 'Government/registry source with company name' };
  }

  // Junk domain - always reject
  const isJunk = JUNK_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
  if (isJunk) {
    return { relevant: false, score: -30, reason: 'SOURCE_REJECTED_LOW_PRIORITY: junk domain' };
  }

  // PDF files - reject unless clearly about company
  if (source.url.toLowerCase().endsWith('.pdf')) {
    if (!titleSnippetRelevant) {
      return { relevant: false, score: -30, reason: 'SOURCE_REJECTED_LOW_PRIORITY: irrelevant PDF' };
    }
  }

  // Extracted text confirms relevance
  if (extractedRelevant) {
    return { relevant: true, score: 20, reason: 'Extracted text contains company name' };
  }

  // Title/snippet confirms relevance
  if (titleSnippetRelevant) {
    return { relevant: true, score: 15, reason: 'Title/snippet contains company name' };
  }

  // No company match anywhere
  return { relevant: false, score: -50, reason: 'SOURCE_REJECTED_IRRELEVANT: no company name match in title, snippet, or text' };
}

export function calculateSourcePriority(
  source: {
    url: string;
    title: string;
    snippet: string;
    category: string;
    sectionKey: string;
  },
  companyName: string,
  officialDomain?: string | null
): number {
  const aliases = generateAliases(companyName);
  const domain = getDomain(source.url);
  let score = 0;

  // Domain-based scoring
  if (officialDomain && domain === getDomain(officialDomain)) {
    score += 40;
  } else if (domainBelongsToCompany(source.url, companyName, aliases)) {
    score += 40;
  }

  // Gov / registry
  if (domain.endsWith('.gov') || domain.endsWith('.gov.uk') || source.category === 'public_registry') {
    score += 30;
  }

  // LinkedIn
  if (domain === 'linkedin.com' || domain.endsWith('.linkedin.com')) {
    score += 25;
  }

  // Credible business databases
  if (HIGH_VALUE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    score += 25;
  }

  // Company sub-pages
  if (officialDomain) {
    const officialHost = getDomain(officialDomain);
    if (domain === officialHost) {
      const path = new URL(source.url).pathname.toLowerCase();
      if (path.includes('contact') || path.includes('about') || path.includes('leadership') || path.includes('team')) {
        score += 20;
      }
    }
  }

  // Title/snippet contains company name
  const titleSnippet = `${source.title} ${source.snippet}`.toLowerCase();
  const hasCompanyName = aliases.some((a) => titleSnippet.includes(a));
  if (!hasCompanyName) {
    score -= 50;
  }

  // Junk
  if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    score -= 30;
  }

  // PDF
  if (source.url.toLowerCase().endsWith('.pdf') && !hasCompanyName) {
    score -= 30;
  }

  return score;
}

export function isHighValueFailedSource(
  source: {
    url: string;
    title: string;
    snippet: string;
    sectionKey: string;
    category?: string;
  },
  companyName: string,
  officialDomain?: string | null
): boolean {
  const aliases = generateAliases(companyName);
  const domain = getDomain(source.url);
  const titleSnippet = `${source.title} ${source.snippet}`.toLowerCase();
  const hasCompanyName = aliases.some((a) => titleSnippet.includes(a));

  // Must have company name in title/snippet or be on company domain
  if (!hasCompanyName && !domainBelongsToCompany(source.url, companyName, aliases)) {
    if (!(officialDomain && domain === getDomain(officialDomain))) {
      return false;
    }
  }

  // Official website or sub-pages
  if (officialDomain && domain === getDomain(officialDomain)) return true;
  if (domainBelongsToCompany(source.url, companyName, aliases)) return true;

  // LinkedIn company page
  if ((domain === 'linkedin.com' || domain.endsWith('.linkedin.com')) && hasCompanyName) return true;

  // Secretary of State / official registry
  if ((domain.endsWith('.gov') || domain.endsWith('.gov.uk')) && hasCompanyName) return true;

  // Credible business databases
  if (HIGH_VALUE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`)) && hasCompanyName) return true;

  // Press releases about company
  if (['prnewswire.com', 'businesswire.com', 'globenewswire.com'].some((d) => domain.includes(d)) && hasCompanyName) return true;

  return false;
}
