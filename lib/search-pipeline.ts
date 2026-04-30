export function buildSearchQueries(
  companyName: string,
  country?: string | null,
  officialWebsite?: string | null
): string[] {
  const loc = country || '';

  const queries = [
    `"${companyName}" official website`,
    `"${companyName}" company registry registration number legal entity ${loc}`.trim(),
    `"${companyName}" incorporation date founded registered ${loc}`.trim(),
    `"${companyName}" contact address location offices ${loc}`.trim(),
    `"${companyName}" about services products solutions`,
    `"${companyName}" leadership management founder CEO`,
    `"${companyName}" parent company group subsidiary`,
    `"${companyName}" government contract public sector tender procurement`,
    `"${companyName}" OpenCorporates OR D&B OR company profile`,
  ];

  if (loc) {
    queries.push(`"${companyName}" secretary of state ${loc}`);
    const countryLower = loc.toLowerCase();
    if (countryLower.includes('germany') || countryLower.includes('deutsch')) {
      queries.push(`"${companyName}" Handelsregister HRB`);
      queries.push(`"${companyName}" northdata.de`);
    } else if (countryLower.includes('uk') || countryLower.includes('united kingdom') || countryLower.includes('england')) {
      queries.push(`"${companyName}" Companies House incorporation`);
    } else if (countryLower.includes('us') || countryLower.includes('united states') || countryLower.includes('canada')) {
      queries.push(`"${companyName}" corporation registration incorporated`);
    } else if (countryLower.includes('italy') || countryLower.includes('italia')) {
      queries.push(`"${companyName}" REA camera di commercio`);
      queries.push(`"${companyName}" partita IVA`);
    } else if (countryLower.includes('france') || countryLower.includes('french')) {
      queries.push(`"${companyName}" SIRET societe.com`);
    } else if (countryLower.includes('netherlands') || countryLower.includes('dutch')) {
      queries.push(`"${companyName}" KvK kvk.nl`);
    }
  }

  if (officialWebsite) {
    try {
      const domain = new URL(officialWebsite).hostname;
      queries.push(`site:${domain} contact OR locations OR offices`);
      queries.push(`site:${domain} about OR leadership OR team`);
    } catch { /* skip */ }
  }

  return queries;
}

export const MAX_CAPTURE_URLS = 12;
