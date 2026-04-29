export function buildSearchQueries(
  companyName: string,
  country?: string | null,
  reportType?: string
): string[] {
  const loc = country || '';
  const queries: string[] = [];

  // Official website / identity
  queries.push(`"${companyName}" official website`);
  queries.push(`"${companyName}" ${loc}`);

  // Company activity / services
  queries.push(`"${companyName}" about services products`);
  queries.push(`"${companyName}" what does company do`);

  // Contact / address
  queries.push(`"${companyName}" address contact location ${loc}`);
  queries.push(`"${companyName}" office headquarters`);

  // Corporate registry
  queries.push(`"${companyName}" corporation registry ${loc}`);
  queries.push(`"${companyName}" secretary of state business entity`);
  queries.push(`"${companyName}" registered agent incorporation`);

  // Management / ownership
  queries.push(`"${companyName}" CEO founder management leadership`);
  queries.push(`"${companyName}" owner president director`);

  // Group / parent / shareholding
  queries.push(`"${companyName}" parent company subsidiary ownership structure`);

  // Adverse media
  queries.push(`"${companyName}" lawsuit fraud sanction investigation`);

  // Legal / regulatory
  queries.push(`"${companyName}" court case regulatory filing`);

  // Sanctions / watchlist
  if (reportType === 'kyc' || reportType === 'full') {
    queries.push(`"${companyName}" OFAC sanctions list`);
  }

  return queries.filter((q) => q.trim().length > 0);
}
