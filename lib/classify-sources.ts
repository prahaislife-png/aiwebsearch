export type SourceCategory =
  | 'official_website'
  | 'contact_address'
  | 'company_activity'
  | 'public_registry'
  | 'ownership_management'
  | 'linkedin_profile'
  | 'third_party_business_profile'
  | 'adverse_media'
  | 'legal_regulatory'
  | 'sanctions_watchlist'
  | 'search_result_only'
  | 'irrelevant';

export interface ClassifiedSource {
  url: string;
  title: string;
  snippet: string;
  category: SourceCategory;
  sectionKey: string;
  sectionTitle: string;
  shouldCapture: boolean;
}

const BLOCKED_DOMAINS = [
  'bloomberg.com',
  'linkedin.com',
  'zoominfo.com',
  'dnb.com',
  'mapquest.com',
  'greatplacetowork.com',
  'glassdoor.com',
  'wikipedia.org',
  'crunchbase.com',
  'pitchbook.com',
  'indeed.com',
  'salary.com',
  'ziprecruiter.com',
];

const CATEGORY_TO_SECTION: Record<SourceCategory, { key: string; title: string }> = {
  official_website: { key: 'official_website', title: 'Official Website / Homepage' },
  contact_address: { key: 'contact_location', title: 'Contact / Location / Operational Address' },
  company_activity: { key: 'about_company', title: 'About / Activity / Products / Services' },
  public_registry: { key: 'public_registry', title: 'Corporate Registry / Public Record' },
  ownership_management: { key: 'management_history', title: 'History / Founder / Management / Ownership' },
  linkedin_profile: { key: 'group_shareholding', title: 'Corporate Group / Parent / Shareholding' },
  third_party_business_profile: { key: 'about_company', title: 'About / Activity / Products / Services' },
  adverse_media: { key: 'adverse_media', title: 'Adverse Media / Negative News' },
  legal_regulatory: { key: 'legal_regulatory', title: 'Legal / Regulatory Records' },
  sanctions_watchlist: { key: 'sanctions_watchlist', title: 'Sanctions / Watchlist Screening' },
  search_result_only: { key: 'other', title: 'Other / Additional Source' },
  irrelevant: { key: 'irrelevant', title: 'Irrelevant' },
};

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let host = u.hostname.replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.toLowerCase().trim();
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isBlockedDomain(url: string): boolean {
  const domain = getDomain(url);
  return BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function isJobPosting(title: string, snippet: string): boolean {
  const combined = `${title} ${snippet}`.toLowerCase();
  const jobKeywords = ['job', 'career', 'hiring', 'apply now', 'salary', 'remote work', 'job opening', 'glassdoor'];
  return jobKeywords.filter((k) => combined.includes(k)).length >= 2;
}

export function classifySearchResult(
  result: { url: string; title: string; snippet: string },
  companyName: string,
  _country?: string | null
): SourceCategory {
  const { url, title, snippet } = result;
  const combined = `${title} ${snippet}`.toLowerCase();
  const domain = getDomain(url);
  const companyLower = companyName.toLowerCase();
  const companyWords = companyLower.split(/\s+/).filter((w) => w.length > 2);

  if (isJobPosting(title, snippet)) return 'irrelevant';

  if (domain === 'linkedin.com' || domain.endsWith('.linkedin.com')) return 'linkedin_profile';

  if (['dnb.com', 'bloomberg.com', 'zoominfo.com', 'crunchbase.com', 'pitchbook.com'].some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return 'third_party_business_profile';
  }

  const registryKeywords = ['secretary of state', 'business entity', 'registry', 'corporation search', 'registered agent', 'filing', 'annual report'];
  const isGovDomain = domain.endsWith('.gov') || domain.endsWith('.gov.uk') || domain.endsWith('.gc.ca');
  if (isGovDomain || registryKeywords.some((k) => combined.includes(k))) return 'public_registry';

  const sanctionsKeywords = ['ofac', 'sanctions list', 'sanctioned', 'sdn list', 'denied persons', 'watchlist'];
  if (sanctionsKeywords.some((k) => combined.includes(k))) return 'sanctions_watchlist';

  const adverseKeywords = ['lawsuit', 'fraud', 'sanction', 'investigation', 'penalty', 'fine', 'indictment', 'convicted', 'violation'];
  if (adverseKeywords.some((k) => combined.includes(k))) return 'adverse_media';

  const legalKeywords = ['court', 'docket', 'case number', 'plaintiff', 'defendant', 'ruling', 'regulatory action'];
  if (legalKeywords.some((k) => combined.includes(k))) return 'legal_regulatory';

  const ownershipKeywords = ['founder', 'ceo', 'management', 'leadership', 'ownership', 'president', 'director', 'board'];
  if (ownershipKeywords.some((k) => combined.includes(k))) return 'ownership_management';

  const contactKeywords = ['contact', 'address', 'location', 'office', 'phone', 'directions'];
  if (contactKeywords.some((k) => combined.includes(k)) || url.toLowerCase().includes('/contact')) return 'contact_address';

  const activityKeywords = ['about', 'services', 'products', 'solutions', 'what we do', 'our company'];
  if (activityKeywords.some((k) => combined.includes(k)) || url.toLowerCase().includes('/about')) return 'company_activity';

  const domainMatchesCompany = companyWords.some((w) => domain.includes(w));
  if (domainMatchesCompany) return 'official_website';

  return 'search_result_only';
}

export function shouldCaptureSource(source: ClassifiedSource): boolean {
  if (source.category === 'irrelevant') return false;
  return !isBlockedDomain(source.url);
}

export function dedupeSources(sources: ClassifiedSource[]): ClassifiedSource[] {
  const seen = new Map<string, ClassifiedSource>();

  for (const source of sources) {
    const normalized = normalizeUrl(source.url);
    const existing = seen.get(normalized);

    if (!existing) {
      seen.set(normalized, source);
    } else {
      const priority: SourceCategory[] = [
        'official_website', 'public_registry', 'ownership_management',
        'contact_address', 'company_activity', 'adverse_media',
        'legal_regulatory', 'sanctions_watchlist', 'linkedin_profile',
        'third_party_business_profile', 'search_result_only', 'irrelevant',
      ];
      if (priority.indexOf(source.category) < priority.indexOf(existing.category)) {
        seen.set(normalized, source);
      }
    }
  }

  return Array.from(seen.values());
}

export function classifyAndPrepare(
  results: { url: string; title: string; snippet: string }[],
  companyName: string,
  country?: string | null
): ClassifiedSource[] {
  const classified: ClassifiedSource[] = results
    .filter((r) => r.url && r.title)
    .map((r) => {
      const category = classifySearchResult(r, companyName, country);
      const section = CATEGORY_TO_SECTION[category];
      return {
        url: r.url,
        title: r.title,
        snippet: r.snippet || '',
        category,
        sectionKey: section.key,
        sectionTitle: section.title,
        shouldCapture: !isBlockedDomain(r.url) && category !== 'irrelevant',
      };
    });

  const deduped = dedupeSources(classified);
  return deduped.filter((s) => s.category !== 'irrelevant');
}
