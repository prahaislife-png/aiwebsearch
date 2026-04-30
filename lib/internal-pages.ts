export type InternalPageCategory =
  | 'contact_address'
  | 'company_activity'
  | 'management'
  | 'legal'
  | 'other';

export interface InternalPageCandidate {
  url: string;
  category: InternalPageCategory;
  sectionKey: string;
  sectionTitle: string;
  priority: number;
  source: 'extracted' | 'guessed';
}

const CATEGORY_KEYWORDS: Record<InternalPageCategory, string[]> = {
  contact_address: [
    'contact', 'contact-us', 'contact_us', 'locations', 'location',
    'offices', 'office', 'address', 'find-us', 'connect', 'where-we-are',
    'office-locations', 'our-offices', 'get-in-touch',
  ],
  company_activity: [
    'services', 'solutions', 'products', 'industries', 'what-we-do',
    'customers', 'success-stories', 'capabilities', 'offerings',
    'our-work', 'case-studies', 'portfolio',
  ],
  management: [
    'about', 'about-us', 'company', 'leadership', 'team', 'management',
    'executives', 'board', 'founders', 'news', 'press', 'media',
    'our-team', 'who-we-are', 'executive-team', 'board-of-directors',
  ],
  legal: [
    'privacy', 'terms', 'cookies', 'imprint', 'legal',
    'privacy-policy', 'terms-of-service',
  ],
  other: [],
};

const CATEGORY_TO_SECTION: Record<InternalPageCategory, { key: string; title: string }> = {
  contact_address: { key: 'operational_address', title: 'Operational Address' },
  company_activity: { key: 'website_activity', title: 'Website and Business Activity' },
  management: { key: 'ownership_management', title: 'Ownership / Management' },
  legal: { key: 'company_identity', title: 'Company Identity' },
  other: { key: 'company_identity', title: 'Company Identity' },
};

const COMMON_PATHS: Record<InternalPageCategory, string[]> = {
  contact_address: [
    '/contact', '/contact-us', '/locations', '/location',
    '/offices', '/office-locations',
  ],
  company_activity: [
    '/services', '/solutions', '/products', '/what-we-do',
  ],
  management: [
    '/about', '/about-us', '/leadership', '/team',
    '/management', '/executive-team', '/company',
  ],
  legal: ['/privacy', '/terms'],
  other: [],
};

function getBaseDomain(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return '';
  }
}

function classifyInternalUrl(path: string): InternalPageCategory {
  const lower = path.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [InternalPageCategory, string[]][]) {
    if (category === 'other') continue;
    for (const kw of keywords) {
      if (lower.includes(kw)) return category;
    }
  }

  return 'other';
}

export function extractInternalLinks(homepageUrl: string, extractedText: string): string[] {
  const base = getBaseDomain(homepageUrl);
  if (!base) return [];

  const links: string[] = [];
  const urlRegex = /https?:\/\/[^\s"'<>]+/g;
  const matches = extractedText.match(urlRegex) || [];

  for (const match of matches) {
    try {
      const u = new URL(match);
      const linkBase = `${u.protocol}//${u.hostname}`;
      if (linkBase === base && u.pathname !== '/' && u.pathname.length > 1) {
        const cleaned = `${linkBase}${u.pathname}`.replace(/\/+$/, '');
        if (!links.includes(cleaned)) {
          links.push(cleaned);
        }
      }
    } catch { /* skip invalid */ }
  }

  // Also extract relative-looking paths from text
  const pathRegex = /\/([\w-]+(?:\/[\w-]+)*)/g;
  const hostname = new URL(homepageUrl).hostname;
  let pathMatch;
  while ((pathMatch = pathRegex.exec(extractedText)) !== null) {
    const path = pathMatch[0];
    if (path.length > 2 && path.length < 60 && !path.includes('.js') && !path.includes('.css') && !path.includes('.png')) {
      const fullUrl = `${base}${path}`;
      if (!links.includes(fullUrl)) {
        links.push(fullUrl);
      }
    }
  }

  return links;
}

export function discoverImportantInternalPages(
  homepageUrl: string,
  extractedText: string,
  maxPages: number = 6
): InternalPageCandidate[] {
  const base = getBaseDomain(homepageUrl);
  if (!base) return [];

  const extractedLinks = extractInternalLinks(homepageUrl, extractedText);
  console.log(`[InternalPages] INTERNAL_LINKS_EXTRACTED: ${extractedLinks.length} links from homepage`);

  const candidates: InternalPageCandidate[] = [];
  const seenPaths = new Set<string>();

  // Classify extracted links
  for (const link of extractedLinks) {
    try {
      const path = new URL(link).pathname.toLowerCase();
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);

      const category = classifyInternalUrl(path);
      if (category === 'other') continue;

      const section = CATEGORY_TO_SECTION[category];
      candidates.push({
        url: link,
        category,
        sectionKey: section.key,
        sectionTitle: section.title,
        priority: getCategoryPriority(category),
        source: 'extracted',
      });
    } catch { /* skip */ }
  }

  // Add guessed common paths that weren't found
  for (const [category, paths] of Object.entries(COMMON_PATHS) as [InternalPageCategory, string[]][]) {
    if (category === 'other') continue;

    const hasCategoryPage = candidates.some((c) => c.category === category);
    if (hasCategoryPage) continue;

    for (const path of paths) {
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);

      const section = CATEGORY_TO_SECTION[category];
      candidates.push({
        url: `${base}${path}`,
        category,
        sectionKey: section.key,
        sectionTitle: section.title,
        priority: getCategoryPriority(category) - 5,
        source: 'guessed',
      });
      break; // Only one guess per category
    }
  }

  // Sort by priority (highest first) and take top N
  candidates.sort((a, b) => b.priority - a.priority);

  // Deduplicate by category — keep at most 2 per category
  const result: InternalPageCandidate[] = [];
  const categoryCounts: Record<string, number> = {};

  for (const candidate of candidates) {
    const count = categoryCounts[candidate.category] || 0;
    if (count >= 2) continue;
    categoryCounts[candidate.category] = count + 1;
    result.push(candidate);
    if (result.length >= maxPages) break;
  }

  for (const page of result) {
    console.log(`[InternalPages] IMPORTANT_INTERNAL_PAGE_SELECTED: ${page.category} -> ${page.url} (${page.source})`);
  }

  return result;
}

function getCategoryPriority(category: InternalPageCategory): number {
  switch (category) {
    case 'contact_address': return 50;
    case 'management': return 45;
    case 'company_activity': return 40;
    case 'legal': return 20;
    default: return 10;
  }
}

export function classifyAndPrioritizeLinks(
  links: string[],
  homepageUrl: string,
  maxPages: number = 6
): InternalPageCandidate[] {
  const base = getBaseDomain(homepageUrl);
  if (!base) return [];

  const candidates: InternalPageCandidate[] = [];
  const seenPaths = new Set<string>();

  for (const link of links) {
    try {
      const u = new URL(link);
      const linkBase = `${u.protocol}//${u.hostname}`;
      if (linkBase !== base) continue;
      if (u.pathname === '/' || u.pathname.length <= 1) continue;

      const path = u.pathname.toLowerCase();
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);

      const category = classifyInternalUrl(path);
      if (category === 'other') continue;

      const section = CATEGORY_TO_SECTION[category];
      candidates.push({
        url: `${linkBase}${u.pathname}`.replace(/\/+$/, ''),
        category,
        sectionKey: section.key,
        sectionTitle: section.title,
        priority: getCategoryPriority(category),
        source: 'extracted',
      });
    } catch { /* skip invalid */ }
  }

  // Add guessed common paths for missing categories
  for (const [category, paths] of Object.entries(COMMON_PATHS) as [InternalPageCategory, string[]][]) {
    if (category === 'other') continue;
    const hasCategoryPage = candidates.some((c) => c.category === category);
    if (hasCategoryPage) continue;

    for (const path of paths) {
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);

      const section = CATEGORY_TO_SECTION[category];
      candidates.push({
        url: `${base}${path}`,
        category,
        sectionKey: section.key,
        sectionTitle: section.title,
        priority: getCategoryPriority(category) - 5,
        source: 'guessed',
      });
      break;
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  const result: InternalPageCandidate[] = [];
  const categoryCounts: Record<string, number> = {};

  for (const candidate of candidates) {
    const count = categoryCounts[candidate.category] || 0;
    if (count >= 2) continue;
    categoryCounts[candidate.category] = count + 1;
    result.push(candidate);
    if (result.length >= maxPages) break;
  }

  return result;
}
