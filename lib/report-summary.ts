import { buildCoverageSummary, generateFinalSummary, CoverageSummary } from './coverage';

interface EvidenceItem {
  section_key: string;
  capture_status: string;
  confidence?: string | null;
  flags?: string[] | null;
}

export interface ReportSummary {
  officialWebsite: 'Yes' | 'No' | 'Partial';
  companyActivity: 'Yes' | 'No' | 'Partial';
  contactAddress: 'Yes' | 'No' | 'Partial';
  publicRegistry: 'Yes' | 'No' | 'Partial';
  managementHistory: 'Yes' | 'No' | 'Partial';
  ownershipGroup: 'Yes' | 'No' | 'Partial' | 'Not applicable';
  manualReviewNeeded: 'Yes' | 'No';
  evidenceScore: number;
  evidenceStrength: string;
}

export function generateSummary(
  evidenceItems: EvidenceItem[],
  reportType: string
): { summary: ReportSummary; finalComment: string; coverage: CoverageSummary } {
  const coverage = buildCoverageSummary(evidenceItems);

  const statusToVerdict = (sectionKeys: string[]): 'Yes' | 'No' | 'Partial' => {
    const items = evidenceItems.filter((e) => sectionKeys.includes(e.section_key));
    const captured = items.filter((e) => e.capture_status === 'captured');
    const searchOnly = items.filter((e) => e.capture_status === 'search_only');

    if (captured.length > 0) {
      const hasHigh = captured.some((e) => e.confidence === 'High');
      return hasHigh ? 'Yes' : 'Partial';
    }
    if (searchOnly.length > 0) return 'Partial';
    return 'No';
  };

  const hasManualReview = evidenceItems.some(
    (e) => e.flags && Array.isArray(e.flags) && e.flags.includes('manual_review_needed')
  );

  const summary: ReportSummary = {
    officialWebsite: statusToVerdict(['official_website']),
    companyActivity: statusToVerdict(['about_company']),
    contactAddress: statusToVerdict(['contact_location']),
    publicRegistry: statusToVerdict(['public_registry']),
    managementHistory: statusToVerdict(['management_history']),
    ownershipGroup:
      reportType === 'enhanced' || reportType === 'kyc' || reportType === 'full'
        ? statusToVerdict(['group_shareholding'])
        : 'Not applicable',
    manualReviewNeeded: hasManualReview ? 'Yes' : 'No',
    evidenceScore: coverage.score,
    evidenceStrength: coverage.strength,
  };

  const finalComment = generateFinalSummary(coverage);

  return { summary, finalComment, coverage };
}
