export interface CoverageItem {
  category: string;
  label: string;
  status: 'Found' | 'Partial' | 'Not found' | 'Not publicly available' | 'Not checked';
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
}

const COVERAGE_CATEGORIES = [
  { category: 'company_identity', label: 'Company Identity', sectionKeys: ['company_identity'], points: 15 },
  { category: 'public_registry', label: 'Public Registry', sectionKeys: ['public_registry'], points: 20 },
  { category: 'website_activity', label: 'Website / Activity', sectionKeys: ['website_activity'], points: 20 },
  { category: 'operational_address', label: 'Operational Address', sectionKeys: ['operational_address'], points: 20 },
  { category: 'ownership_management', label: 'Ownership / Management', sectionKeys: ['ownership_management'], points: 10 },
  { category: 'corporate_group', label: 'Corporate Group', sectionKeys: ['corporate_group'], points: 10 },
  { category: 'government_connections', label: 'Government Connections', sectionKeys: ['government_connections'], points: 5 },
];

export function buildCoverageSummary(evidence: EvidenceRow[], checkedSections?: Set<string>): CoverageSummary {
  const items: CoverageItem[] = COVERAGE_CATEGORIES.map(({ category, label, sectionKeys }) => {
    const matching = evidence.filter((e) => sectionKeys.includes(e.section_key));
    const captured = matching.filter((e) => e.capture_status === 'captured');
    const searchOnly = matching.filter((e) => e.capture_status === 'search_only');

    const wasChecked = checkedSections
      ? sectionKeys.some((k) => checkedSections.has(k))
      : matching.length > 0;

    let status: CoverageItem['status'] = wasChecked ? 'Not found' : 'Not checked';
    if (captured.length > 0) {
      const hasHigh = captured.some((e) => e.confidence === 'High');
      status = hasHigh ? 'Found' : 'Found';
    } else if (searchOnly.length > 0) {
      status = 'Partial';
    }

    return { category, label, status, sourceCount: matching.length };
  });

  const score = calculateEvidenceScore(items);
  const strength: CoverageSummary['strength'] =
    score >= 70 ? 'Strong' : score >= 45 ? 'Moderate' : 'Weak';

  return { items, score, strength };
}

function calculateEvidenceScore(coverage: CoverageItem[]): number {
  let score = 0;

  for (const item of coverage) {
    const cat = COVERAGE_CATEGORIES.find((c) => c.category === item.category);
    if (!cat) continue;

    if (item.status === 'Found') {
      score += cat.points;
    } else if (item.status === 'Partial') {
      score += Math.floor(cat.points * 0.5);
    }
    // "Not found" and "Not checked" contribute 0
  }

  return Math.min(100, score);
}

export function generateFinalSummary(coverage: CoverageSummary): string {
  const { items } = coverage;
  const found = items.filter((i) => i.status === 'Found').length;
  const partial = items.filter((i) => i.status === 'Partial').length;

  if (found >= 5) {
    return `Investigation completed. ${found} of 7 verification areas confirmed with captured evidence${partial > 0 ? `, ${partial} with partial evidence` : ''}.`;
  }

  if (found >= 3) {
    const gaps = items.filter((i) => i.status === 'Not found' || i.status === 'Not checked').map((i) => i.label);
    let text = `Investigation completed. ${found} areas confirmed${partial > 0 ? `, ${partial} partially covered` : ''}.`;
    if (gaps.length > 0) text += ` Gaps: ${gaps.join(', ')}.`;
    return text;
  }

  if (found > 0 || partial > 0) {
    return `Investigation completed with limited evidence. ${found} areas confirmed, ${partial} partially covered.`;
  }

  return `Investigation completed. Limited public information available for verification.`;
}
