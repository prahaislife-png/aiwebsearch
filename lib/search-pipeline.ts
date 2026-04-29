export function buildSearchQueries(
  companyName: string,
  country?: string | null,
  reportType?: string
): string[] {
  const loc = country || '';

  if (reportType === 'basic' || reportType === 'BASIC' || !reportType) {
    return [
      `"${companyName}" official website`,
      `"${companyName}" address ${loc}`.trim(),
      `"${companyName}" contact`,
      `"${companyName}" leadership CEO founder`,
      `"${companyName}" LinkedIn`,
      `"${companyName}" company profile`,
      `"${companyName}" Secretary of State ${loc}`.trim(),
      `"${companyName}" lawsuit sanctions adverse media`,
    ];
  }

  // Enhanced/KYC/Full reports get more queries
  return [
    `"${companyName}" official website`,
    `"${companyName}" ${loc}`.trim(),
    `"${companyName}" about services products`,
    `"${companyName}" address contact location ${loc}`.trim(),
    `"${companyName}" office headquarters`,
    `"${companyName}" corporation registry ${loc}`.trim(),
    `"${companyName}" Secretary of State business entity`,
    `"${companyName}" registered agent incorporation`,
    `"${companyName}" CEO founder management leadership`,
    `"${companyName}" owner president director`,
    `"${companyName}" parent company subsidiary ownership`,
    `"${companyName}" LinkedIn company`,
    `"${companyName}" lawsuit fraud sanction investigation`,
    `"${companyName}" court case regulatory filing`,
    `"${companyName}" OFAC sanctions list`,
  ];
}

export const MAX_CAPTURE_URLS: Record<string, number> = {
  basic: 10,
  BASIC: 10,
  enhanced: 15,
  kyc: 15,
  full: 20,
};
