import { CaptureResult } from '../browser-capture/capture-provider';
import { runActor, getDatasetItems } from './client';
import { uploadScreenshot } from '../browser-capture/screenshot-storage';

interface GoogleMapsPlace {
  title?: string;
  address?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  state?: string;
  countryCode?: string;
  phone?: string;
  website?: string;
  categoryName?: string;
  totalScore?: number;
  reviewsCount?: number;
  openingHours?: { day: string; hours: string }[];
  url?: string;
  location?: { lat: number; lng: number };
}

function fuzzyMatch(companyName: string, placeName: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const companyNorm = normalize(companyName);
  const placeNorm = normalize(placeName);
  if (placeNorm.includes(companyNorm) || companyNorm.includes(placeNorm)) return true;
  const companyWords = companyName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const matchCount = companyWords.filter((w) => placeNorm.includes(w.replace(/[^a-z0-9]/g, ''))).length;
  return matchCount >= Math.ceil(companyWords.length * 0.5);
}

async function captureGoogleMapsScreenshot(mapsUrl: string, jobId: string): Promise<string | undefined> {
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(mapsUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Dismiss consent dialog if present
    const consentBtn = await page.$('button[aria-label*="Accept"], form[action*="consent"] button');
    if (consentBtn) {
      await consentBtn.click();
      await page.waitForTimeout(2000);
    }

    const screenshotBuffer = await page.screenshot({ fullPage: false });
    await browser.close();

    return await uploadScreenshot(jobId, mapsUrl, Buffer.from(screenshotBuffer));
  } catch (err) {
    console.warn('[ApifyMaps] Screenshot capture failed:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

export async function enrichWithGoogleMaps(params: {
  companyName: string;
  country?: string | null;
  jobId: string;
}): Promise<CaptureResult | null> {
  const actorId = process.env.APIFY_GOOGLE_MAPS_ACTOR_ID;
  if (!actorId) return null;

  const searchQuery = params.country
    ? `${params.companyName} ${params.country}`
    : params.companyName;

  console.log(`[ApifyMaps] Searching Google Maps for: "${searchQuery}"`);

  const run = await runActor(actorId, {
    searchStringsArray: [searchQuery],
    maxCrawledPlacesPerSearch: 3,
    language: 'en',
    deeperCityScrape: false,
    onePerQuery: false,
  }, { waitSecs: 120, memory: 1024 });

  const items = (await getDatasetItems(run.defaultDatasetId)) as GoogleMapsPlace[];

  if (!items || items.length === 0) {
    console.log('[ApifyMaps] No Google Maps results found');
    return null;
  }

  const match = items.find((item) => item.title && fuzzyMatch(params.companyName, item.title));
  if (!match) {
    console.log(`[ApifyMaps] No matching place found for "${params.companyName}" in ${items.length} results`);
    return null;
  }

  console.log(`[ApifyMaps] MATCH FOUND: "${match.title}" at ${match.address}`);

  const mapsUrl = match.url || `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

  // Capture screenshot of the Google Maps page
  const screenshotUrl = await captureGoogleMapsScreenshot(mapsUrl, params.jobId);
  if (screenshotUrl) {
    console.log(`[ApifyMaps] Screenshot captured for Google Maps result`);
  }

  const lines: string[] = [
    `Google Maps Business Profile: ${match.title}`,
  ];
  if (match.address) lines.push(`Address: ${match.address}`);
  if (match.street) lines.push(`Street: ${match.street}`);
  if (match.city) lines.push(`City: ${match.city}`);
  if (match.postalCode) lines.push(`Postal Code: ${match.postalCode}`);
  if (match.state) lines.push(`State/Region: ${match.state}`);
  if (match.countryCode) lines.push(`Country: ${match.countryCode}`);
  if (match.phone) lines.push(`Phone: ${match.phone}`);
  if (match.website) lines.push(`Website: ${match.website}`);
  if (match.categoryName) lines.push(`Category: ${match.categoryName}`);
  if (match.totalScore) lines.push(`Rating: ${match.totalScore}/5 (${match.reviewsCount || 0} reviews)`);
  if (match.openingHours && match.openingHours.length > 0) {
    lines.push(`Opening Hours:`);
    for (const h of match.openingHours) {
      lines.push(`  ${h.day}: ${h.hours}`);
    }
  }

  return {
    sectionKey: 'operational_address',
    sectionTitle: 'Operational Address',
    sourceUrl: mapsUrl,
    finalUrl: mapsUrl,
    pageTitle: `Google Maps: ${match.title}`,
    screenshotUrl,
    extractedText: lines.join('\n'),
    capturedAt: new Date().toISOString(),
    status: 'success',
  };
}
