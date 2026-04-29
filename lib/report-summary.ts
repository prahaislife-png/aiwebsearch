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
  reportType: string,
  checkedSections?: Set<string>
): { summary: ReportSummary; finalComment: string; coverage: CoverageSummary } {
  const coverage = buildCoverageSummary(evidenceItems);

  const statusForSection = (sectionKeys: string[]): string => {
    const items = evidenceItems.filter((e) => sectionKeys.includes(e.section_key));
    const captured = items.filter((e) => e.capture_status === 'captured');
    const searchOnly = items.filter((e) => e.capture_status === 'search_only');

    if (captured.length > 0) return 'Captured';
    if (searchOnly.length > 0) return 'Search evidence only';

    // Was this section actually checked?
    const wasChecked = checkedSections
      ? sectionKeys.some((k) => checkedSections.has(k))
      : true;

    return wasChecked ? 'Not found' : 'Not checked';
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
    manualReviewNeeded: hasManualReview || coverage.score < 40 ? 'Yes' : 'No',
    evidenceScore: coverage.score,
    evidenceStrength: coverage.strength,
  };

  // If contact/registry/management are not checked, manual review needed
  const hasUnchecked = [summary.contactAddress, summary.publicRegistry, summary.managementHistory]
    .some((s) => s === 'Not checked' || s === 'Incomplete');
  if (hasUnchecked) {
    summary.manualReviewNeeded = 'Yes';
  }

  const finalComment = generateFinalSummary(coverage);

  return { summary, finalComment, coverage };
}
