import { buildCoverageSummary, generateFinalSummary, CoverageSummary } from './coverage';

interface EvidenceItem {
  section_key: string;
  capture_status: string;
  confidence?: string | null;
  flags?: string[] | null;
}

export interface ReportSummary {
  companyIdentity: string;
  publicRegistry: string;
  officialWebsite: string;
  companyActivity: string;
  operationalAddress: string;
  ownershipManagement: string;
  corporateGroup: string;
  governmentConnections: string;
}

export function generateSummary(
  evidenceItems: EvidenceItem[],
  checkedSections?: Set<string>,
  officialWebsiteProvided?: boolean
): { summary: ReportSummary; finalComment: string; coverage: CoverageSummary } {
  const coverage = buildCoverageSummary(evidenceItems, checkedSections);

  const statusFor = (sectionKeys: string[]): string => {
    const items = evidenceItems.filter((e) => sectionKeys.includes(e.section_key));
    const captured = items.filter((e) => e.capture_status === 'captured');
    const searchOnly = items.filter((e) => e.capture_status === 'search_only');

    if (captured.length > 0) return 'Found';
    if (searchOnly.length > 0) return 'Partial';

    const wasChecked = checkedSections
      ? sectionKeys.some((k) => checkedSections.has(k))
      : items.length > 0;

    return wasChecked ? 'Not found' : 'Not checked';
  };

  // Official website status — if user provided URL, always "Found" unless contradicted
  let websiteStatus = statusFor(['company_identity']);
  if (officialWebsiteProvided && websiteStatus !== 'Found') {
    websiteStatus = 'Found';
  }

  // Cross-section registry detection: if registry data found on any page, upgrade to Partial
  let registryStatus = statusFor(['public_registry']);
  if (registryStatus !== 'Found') {
    const hasRegistryFlag = evidenceItems.some(
      (e) => e.flags?.includes('registry_found') && e.capture_status !== 'blocked_source'
    );
    if (hasRegistryFlag) registryStatus = 'Partial';
  }

  // Cross-section corporate group detection
  let groupStatus = statusFor(['corporate_group']);
  if (groupStatus !== 'Found') {
    const hasGroupFlag = evidenceItems.some(
      (e) => e.flags?.includes('parent_company_found') && e.capture_status !== 'blocked_source'
    );
    if (hasGroupFlag) groupStatus = 'Partial';
  }

  // Cross-section government detection
  let govStatus = statusFor(['government_connections']);
  if (govStatus !== 'Found') {
    const hasGovFlag = evidenceItems.some(
      (e) => e.flags?.includes('government_connection_found') && e.capture_status !== 'blocked_source'
    );
    if (hasGovFlag) govStatus = 'Partial';
  }

  const govDisplay = govStatus === 'Not found' ? 'No evidence found' : govStatus;
  const registryDisplay = registryStatus;

  // Cross-section ownership/management detection
  let ownershipStatus = statusFor(['ownership_management']);
  if (ownershipStatus !== 'Found') {
    const hasManagementFlag = evidenceItems.some(
      (e) => (e.flags?.includes('management_found') || e.flags?.includes('ownership_found'))
        && e.capture_status !== 'blocked_source'
    );
    if (hasManagementFlag) {
      ownershipStatus = 'Partial';
    }
  }
  const ownershipDisplay = ownershipStatus;
  const groupDisplay = groupStatus;

  // Cross-section address detection: upgrade based on whether captured evidence has the flag
  let addressStatus = statusFor(['operational_address']);
  if (addressStatus !== 'Found') {
    const capturedWithAddressFlag = evidenceItems.some(
      (e) => e.flags?.includes('operational_address_found')
        && e.capture_status === 'captured'
    );
    const anyAddressFlag = evidenceItems.some(
      (e) => e.flags?.includes('operational_address_found')
        && e.capture_status !== 'blocked_source'
    );
    if (capturedWithAddressFlag) {
      addressStatus = 'Found';
    } else if (anyAddressFlag) {
      addressStatus = 'Partial';
    }
  }

  const summary: ReportSummary = {
    companyIdentity: websiteStatus,
    publicRegistry: registryDisplay,
    officialWebsite: websiteStatus,
    companyActivity: statusFor(['website_activity']),
    operationalAddress: addressStatus,
    ownershipManagement: ownershipDisplay,
    corporateGroup: groupDisplay,
    governmentConnections: govDisplay,
  };

  const finalComment = generateFinalSummary(coverage);
  return { summary, finalComment, coverage };
}
