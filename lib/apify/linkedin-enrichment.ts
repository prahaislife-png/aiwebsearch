import { CaptureResult } from '../browser-capture/capture-provider';
import { runActor, getDatasetItems } from './client';

interface LinkedInProfile {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  title?: string;
  position?: string;
  profileUrl?: string;
  linkedinUrl?: string;
  companyName?: string;
  location?: string;
}

const LEADERSHIP_ROLES = [
  'ceo', 'cto', 'cfo', 'coo', 'cio', 'cmo',
  'founder', 'co-founder', 'cofounder',
  'president', 'vice president', 'vp',
  'director', 'managing director',
  'owner', 'partner', 'principal',
  'head of', 'chief',
  'general manager', 'country manager',
  'board member', 'chairman',
];

function isLeadership(profile: LinkedInProfile): boolean {
  const title = (profile.headline || profile.title || profile.position || '').toLowerCase();
  return LEADERSHIP_ROLES.some((role) => title.includes(role));
}

export async function enrichWithLinkedIn(params: {
  companyName: string;
  country?: string | null;
  jobId: string;
}): Promise<CaptureResult | null> {
  const actorId = process.env.APIFY_LINKEDIN_ACTOR_ID;
  if (!actorId) return null;

  console.log(`[ApifyLinkedIn] Searching LinkedIn employees for: "${params.companyName}"`);

  const run = await runActor(actorId, {
    companyName: params.companyName,
    count: 15,
    roles: ['CEO', 'CTO', 'CFO', 'COO', 'Founder', 'Director', 'Managing Director', 'Owner', 'President', 'Partner', 'Head'],
  }, { waitSecs: 120, memory: 1024 });

  const items = (await getDatasetItems(run.defaultDatasetId)) as LinkedInProfile[];

  if (!items || items.length === 0) {
    console.log('[ApifyLinkedIn] No LinkedIn profiles found');
    return null;
  }

  const leaders = items.filter(isLeadership);
  const allProfiles = leaders.length > 0 ? leaders : items.slice(0, 5);

  console.log(`[ApifyLinkedIn] Found ${items.length} profiles, ${leaders.length} leadership`);

  const lines: string[] = [
    `LinkedIn Company Profile: ${params.companyName}`,
    `Employees found: ${items.length}`,
    '',
    'Leadership:',
  ];

  for (const profile of allProfiles.slice(0, 10)) {
    const name = profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    const title = profile.headline || profile.title || profile.position || 'Unknown role';
    lines.push(`- ${name}, ${title}`);
  }

  const companyUrl = items[0]?.companyName
    ? `https://www.linkedin.com/company/${encodeURIComponent(params.companyName.toLowerCase().replace(/\s+/g, '-'))}`
    : `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(params.companyName)}`;

  return {
    sectionKey: 'ownership_management',
    sectionTitle: 'Ownership / Management',
    sourceUrl: companyUrl,
    finalUrl: companyUrl,
    pageTitle: `LinkedIn: ${params.companyName} Leadership`,
    extractedText: lines.join('\n'),
    capturedAt: new Date().toISOString(),
    status: 'success',
  };
}
