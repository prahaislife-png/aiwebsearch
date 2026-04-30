export type SourceCategory =
  | 'company_identity'
  | 'public_registry'
  | 'website_activity'
  | 'operational_address'
  | 'ownership_management'
  | 'corporate_group'
  | 'government_connections'
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
  company_identity: { key: 'company_identity', title: 'Company Identity' },
  public_registry: { key: 'public_registry', title: 'Public Registry Evidence' },
  website_activity: { key: 'website_activity', title: 'Website and Business Activity' },
  operational_address: { key: 'operational_address', title: 'Operational Address' },
  ownership_management: { key: 'ownership_management', title: 'Ownership / Management' },
  corporate_group: { key: 'corporate_group', title: 'Corporate Group Information' },
  government_connections: { key: 'government_connections', title: 'Government Connections' },
  irrelevant: { key: 'irrelevant', title: 'Irrelevant' },
};

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
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

  // Government connections
  const govOwnershipKeywords = ['government owned', 'state owned', 'ministry', 'public sector ownership', 'state enterprise', 'government-controlled'];
  if (govOwnershipKeywords.some((k) => combined.includes(k))) return 'government_connections';

  // Public registry
  const registryKeywords = [
    'secretary of state', 'business entity', 'registry', 'corporation search',
    'registered agent', 'filing', 'annual report', 'registration number',
    'legal entity', 'incorporation', 'company number', 'vat number',
    'partita iva', 'handelsregister', 'hrb', 'company profile',
    'rea number', 'share capital', 'camera di commercio',
  ];
  const registryDomains = [
    'opencorporates.com', 'northdata.de', 'firmenwissen.de',
    'kompany.com', 'unternehmensregister.de', 'infocamere.it',
    'registroimprese.it', 'companieshouse.gov.uk',
  ];
  const isGovDomain = domain.endsWith('.gov') || domain.endsWith('.gov.uk') || domain.endsWith('.gc.ca');
  const isRegistryDomain = registryDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
  if (isGovDomain || isRegistryDomain || registryKeywords.some((k) => combined.includes(k))) return 'public_registry';

  // Corporate group
  const groupKeywords = ['parent company', 'subsidiary', 'group structure', 'holding company', 'affiliated', 'corporate group'];
  if (groupKeywords.some((k) => combined.includes(k))) return 'corporate_group';

  // Ownership / management
  const ownershipKeywords = ['founder', 'ceo', 'management', 'leadership', 'ownership', 'president', 'director', 'board', 'executive'];
  if (ownershipKeywords.some((k) => combined.includes(k))) return 'ownership_management';

  // Operational address
  const contactKeywords = ['contact', 'address', 'location', 'office', 'phone', 'directions', 'headquarters'];
  if (contactKeywords.some((k) => combined.includes(k)) || url.toLowerCase().includes('/contact') || url.toLowerCase().includes('/location')) return 'operational_address';

  // Website / activity
  const activityKeywords = ['about', 'services', 'products', 'solutions', 'what we do', 'our company', 'industries'];
  if (activityKeywords.some((k) => combined.includes(k)) || url.toLowerCase().includes('/about')) return 'website_activity';

  // Company identity (company's own domain or profile)
  const domainMatchesCompany = companyWords.some((w) => domain.includes(w));
  if (domainMatchesCompany) return 'company_identity';

  // LinkedIn / business databases → treat as company identity
  if (domain === 'linkedin.com' || domain.endsWith('.linkedin.com')) return 'company_identity';
  if (['dnb.com', 'zoominfo.com', 'crunchbase.com', 'cbinsights.com', 'tracxn.com'].some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return 'company_identity';
  }

  return 'irrelevant';
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
        'company_identity', 'public_registry', 'operational_address',
        'website_activity', 'ownership_management', 'corporate_group',
        'government_connections', 'irrelevant',
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
