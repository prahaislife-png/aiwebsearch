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
}

export function generateSummary(
  evidenceItems: EvidenceItem[],
  reportType: string
): { summary: ReportSummary; finalComment: string } {
  const checkSection = (sectionKey: string): 'Yes' | 'No' | 'Partial' => {
    const items = evidenceItems.filter(
      (e) => e.section_key === sectionKey && e.capture_status === 'captured'
    );
    if (items.length === 0) return 'No';
    const hasHighConfidence = items.some((e) => e.confidence === 'High');
    return hasHighConfidence ? 'Yes' : 'Partial';
  };

  const hasManualReview = evidenceItems.some(
    (e) =>
      e.flags &&
      Array.isArray(e.flags) &&
      e.flags.includes('manual_review_needed')
  );

  const summary: ReportSummary = {
    officialWebsite: checkSection('official_website'),
    companyActivity: checkSection('about_company'),
    contactAddress: checkSection('contact_location'),
    publicRegistry: checkSection('public_registry'),
    managementHistory: checkSection('management_history'),
    ownershipGroup:
      reportType === 'enhanced'
        ? checkSection('group_shareholding')
        : 'Not applicable',
    manualReviewNeeded: hasManualReview ? 'Yes' : 'No',
  };

  const finalComment = `Public web sources were captured for the company. The report includes evidence from the official website, activity/about page, contact/location page, and public registry or ownership sources where available. ${
    hasManualReview
      ? 'Some areas may require manual review where sources were unavailable, blocked, or unclear.'
      : 'No significant issues were identified requiring manual review.'
  }`;

  return { summary, finalComment };
}
