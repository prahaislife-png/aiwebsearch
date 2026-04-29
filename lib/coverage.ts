import { SourceCategory } from './classify-sources';

export interface CoverageItem {
  category: string;
  label: string;
  status: 'Captured' | 'Search evidence only' | 'Not found' | 'Incomplete' | 'Not checked';
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

    let status: CoverageItem['status'] = 'Not found';
    if (captured.length > 0) {
      const hasHigh = captured.some((e) => e.confidence === 'High');
      status = hasHigh ? 'Captured' : 'Captured';
    } else if (searchOnly.length > 0) {
      status = 'Search evidence only';
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

  const catStatus = (cat: string) => coverage.find((c) => c.category === cat)?.status || 'Not found';

  // Official website: +20 found/search, +10 additional if captured
  if (catStatus('official_website') === 'Captured') {
    score += 30;
  } else if (catStatus('official_website') === 'Search evidence only') {
    score += 20;
  }

  // Company activity: +15
  if (catStatus('company_activity') === 'Captured') {
    score += 15;
  } else if (catStatus('company_activity') === 'Search evidence only') {
    score += 10;
  }

  // Address/contact: +15
  if (catStatus('contact_address') === 'Captured') {
    score += 15;
  } else if (catStatus('contact_address') === 'Search evidence only') {
    score += 10;
  }

  // Management: +15
  if (catStatus('ownership_management') === 'Captured') {
    score += 15;
  } else if (catStatus('ownership_management') === 'Search evidence only') {
    score += 10;
  }

  // Registry: +20
  if (catStatus('public_registry') === 'Captured') {
    score += 20;
  } else if (catStatus('public_registry') === 'Search evidence only') {
    score += 10;
  }

  // LinkedIn/business profile: +10
  const hasProfile = evidence.some(
    (e) => (e.section_key === 'group_shareholding' || e.section_key === 'about_company') &&
      (e.capture_status === 'captured' || e.capture_status === 'search_only')
  );
  if (hasProfile) score += 10;

  // Adverse/sanctions checked: +10
  const hasAdverseCheck = evidence.some(
    (e) => e.section_key === 'adverse_media' || e.section_key === 'sanctions_watchlist'
  );
  if (hasAdverseCheck) score += 10;

  // Penalties — only for clear issues, not bulk failures
  const hasAdverseFlag = evidence.some((e) =>
    e.flags?.includes('adverse_found') || e.flags?.includes('sanction_match')
  );
  if (hasAdverseFlag) score -= 30;

  // Penalty if captured sources are irrelevant (shouldn't happen after filtering)
  const capturedWithManualReview = evidence.filter(
    (e) => e.capture_status === 'captured' && e.flags?.includes('manual_review_needed')
  );
  if (capturedWithManualReview.length > 0) score -= 10;

  // Penalty if official website cannot be captured AND no search evidence
  if (catStatus('official_website') === 'Not found') score -= 15;

  // Penalty if registry missing
  if (catStatus('public_registry') === 'Not found') score -= 10;

  return Math.max(0, Math.min(100, score));
}

export function generateFinalSummary(coverage: CoverageSummary): string {
  const { score, strength, items } = coverage;
  const captured = items.filter((i) => i.status === 'Captured');
  const searchOnly = items.filter((i) => i.status === 'Search evidence only');
  const notFound = items.filter((i) => i.status === 'Not found');

  if (strength === 'Strong') {
    return `Investigation completed with strong evidence coverage (score: ${score}/100). ${captured.length} categories verified with captured pages, ${searchOnly.length} supported by search snippets. Sufficient evidence collected for most verification categories.`;
  }

  if (captured.length === 0 && searchOnly.length > 0) {
    return `Investigation completed with limited captured evidence (score: ${score}/100). ${searchOnly.length} useful findings from search snippets, but direct page capture was limited. Manual verification is recommended for key findings.`;
  }

  if (strength === 'Moderate') {
    const gaps = notFound.map((i) => i.label);
    let summary = `Investigation completed with moderate evidence coverage (score: ${score}/100). ${captured.length} categories captured, ${searchOnly.length} with search evidence only.`;
    if (gaps.length > 0) {
      summary += ` Gaps: ${gaps.slice(0, 3).join(', ')}. Manual review recommended.`;
    }
    return summary;
  }

  // Weak
  if (searchOnly.length > 0) {
    return `Investigation completed with limited evidence (score: ${score}/100). Several useful facts were found from search snippets, but direct page capture was limited. Manual verification is recommended.`;
  }

  return `Investigation completed with weak evidence coverage (score: ${score}/100). Limited evidence available. Manual verification strongly recommended before relying on these findings.`;
}
