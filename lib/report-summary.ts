import { buildCoverageSummary, generateFinalSummary, CoverageSummary } from './coverage';

interface EvidenceItem {
  section_key: string;
  capture_status: string;
  confidence?: string | null;
  flags?: string[] | null;
}

export interface ReportSummary {
  officialWebsite: string;
  companyActivity: string;
  contactAddress: string;
  publicRegistry: string;
  managementHistory: string;
  ownershipGroup: string;
  manualReviewNeeded: 'Yes' | 'No';
  evidenceScore: number;
  evidenceStrength: string;
}

export function generateSummary(
  evidenceItems: EvidenceItem[],
  reportType: string
): { summary: ReportSummary; finalComment: string; coverage: CoverageSummary } {
  const coverage = buildCoverageSummary(evidenceItems);

  const statusForSection = (sectionKeys: string[]): string => {
    const items = evidenceItems.filter((e) => sectionKeys.includes(e.section_key));
    const captured = items.filter((e) => e.capture_status === 'captured');
    const searchOnly = items.filter((e) => e.capture_status === 'search_only');

    if (captured.length > 0) {
      const hasHigh = captured.some((e) => e.confidence === 'High');
      return hasHigh ? 'Captured' : 'Captured';
    }
    if (searchOnly.length > 0) return 'Search evidence only';
    return 'Not found';
  };

  const hasManualReview = evidenceItems.some(
    (e) => e.flags && Array.isArray(e.flags) && e.flags.includes('manual_review_needed')
  );

  const summary: ReportSummary = {
    officialWebsite: statusForSection(['official_website']),
    companyActivity: statusForSection(['about_company']),
    contactAddress: statusForSection(['contact_location']),
    publicRegistry: statusForSection(['public_registry']),
    managementHistory: statusForSection(['management_history']),
    ownershipGroup:
      reportType === 'enhanced' || reportType === 'kyc' || reportType === 'full'
        ? statusForSection(['group_shareholding'])
        : 'Not checked',
    manualReviewNeeded: hasManualReview ? 'Yes' : 'No',
    evidenceScore: coverage.score,
    evidenceStrength: coverage.strength,
  };

  const finalComment = generateFinalSummary(coverage);

  return { summary, finalComment, coverage };
}
