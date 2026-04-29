import { SourceCategory } from './classify-sources';

export interface CoverageItem {
  category: string;
  label: string;
  status: 'found' | 'partial' | 'not_found' | 'blocked';
  sourceCount: number;
}

export interface CoverageSummary {
  items: CoverageItem[];
  score: number;
  strength: 'Strong' | 'Moderate' | 'Weak';
}

interface EvidenceRow {
  section_key: string;
  capture_status: string;
  confidence?: string | null;
  flags?: string[] | null;
  category?: SourceCategory;
}

const COVERAGE_CATEGORIES: { category: string; label: string; sectionKeys: string[] }[] = [
  { category: 'official_website', label: 'Official Website', sectionKeys: ['official_website'] },
  { category: 'company_activity', label: 'Company Activity', sectionKeys: ['about_company'] },
  { category: 'contact_address', label: 'Address / Contact', sectionKeys: ['contact_location'] },
  { category: 'public_registry', label: 'Public Registry', sectionKeys: ['public_registry'] },
  { category: 'ownership_management', label: 'Management / Ownership', sectionKeys: ['management_history'] },
  { category: 'group_shareholding', label: 'Group / Shareholding', sectionKeys: ['group_shareholding'] },
  { category: 'adverse_media', label: 'Adverse Media', sectionKeys: ['adverse_media'] },
  { category: 'legal_regulatory', label: 'Legal / Regulatory', sectionKeys: ['legal_regulatory'] },
  { category: 'sanctions_watchlist', label: 'Sanctions Check', sectionKeys: ['sanctions_watchlist'] },
];

export function buildCoverageSummary(evidence: EvidenceRow[]): CoverageSummary {
  const items: CoverageItem[] = COVERAGE_CATEGORIES.map(({ category, label, sectionKeys }) => {
    const matching = evidence.filter((e) => sectionKeys.includes(e.section_key));
    const captured = matching.filter((e) => e.capture_status === 'captured');
    const searchOnly = matching.filter((e) => e.capture_status === 'search_only');
    const failed = matching.filter((e) => e.capture_status === 'failed');

    let status: CoverageItem['status'] = 'not_found';
    if (captured.length > 0) {
      status = 'found';
    } else if (searchOnly.length > 0) {
      status = 'partial';
    } else if (failed.length > 0) {
      status = 'blocked';
    }

    return { category, label, status, sourceCount: matching.length };
  });

  const score = calculateEvidenceScore(evidence, items);
  const strength: CoverageSummary['strength'] =
    score >= 80 ? 'Strong' : score >= 50 ? 'Moderate' : 'Weak';

  return { items, score, strength };
}

function calculateEvidenceScore(evidence: EvidenceRow[], coverage: CoverageItem[]): number {
  let score = 0;

  const catStatus = (cat: string) => coverage.find((c) => c.category === cat)?.status || 'not_found';

  if (catStatus('official_website') === 'found') score += 20;
  else if (catStatus('official_website') === 'partial') score += 10;

  if (catStatus('contact_address') === 'found') score += 15;
  else if (catStatus('contact_address') === 'partial') score += 8;

  if (catStatus('public_registry') === 'found') score += 20;
  else if (catStatus('public_registry') === 'partial') score += 10;

  if (catStatus('ownership_management') === 'found') score += 15;
  else if (catStatus('ownership_management') === 'partial') score += 8;

  if (catStatus('company_activity') === 'found') score += 10;
  else if (catStatus('company_activity') === 'partial') score += 5;

  const hasLinkedInOrProfile = evidence.some(
    (e) => e.section_key === 'group_shareholding' && (e.capture_status === 'captured' || e.capture_status === 'search_only')
  );
  if (hasLinkedInOrProfile) score += 10;

  const hasAdverseCheck = evidence.some((e) => e.section_key === 'adverse_media' || e.section_key === 'sanctions_watchlist');
  if (hasAdverseCheck) score += 10;

  const failedCount = evidence.filter((e) => e.capture_status === 'failed').length;
  score -= Math.min(failedCount * 5, 20);

  const hasAdverseFlag = evidence.some((e) =>
    e.flags?.includes('adverse_found') || e.flags?.includes('sanction_match')
  );
  if (hasAdverseFlag) score -= 30;

  return Math.max(0, Math.min(100, score));
}

export function generateFinalSummary(coverage: CoverageSummary): string {
  const { score, strength, items } = coverage;
  const found = items.filter((i) => i.status === 'found').length;
  const partial = items.filter((i) => i.status === 'partial').length;
  const notFound = items.filter((i) => i.status === 'not_found' || i.status === 'blocked').length;

  let summary = `Investigation completed with ${strength.toLowerCase()} evidence coverage (score: ${score}/100). `;
  summary += `${found} categories fully verified, ${partial} partially covered, ${notFound} gaps remain. `;

  if (strength === 'Strong') {
    summary += 'Sufficient evidence collected for most verification categories.';
  } else if (strength === 'Moderate') {
    const gaps = items.filter((i) => i.status === 'not_found' || i.status === 'blocked').map((i) => i.label);
    summary += `Key gaps: ${gaps.slice(0, 3).join(', ')}. Manual review recommended.`;
  } else {
    summary += 'Limited evidence available. Manual verification strongly recommended before relying on these findings.';
  }

  return summary;
}
