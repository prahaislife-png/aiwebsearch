import { chromium, Browser, Page } from 'playwright';
import { CaptureProvider, CaptureInput, CaptureResult } from './capture-provider';
import { uploadScreenshot } from './screenshot-storage';
import { classifyAndPrioritizeLinks, InternalPageCandidate } from '@/lib/internal-pages';

const TIMEOUT = parseInt(process.env.PLAYWRIGHT_TIMEOUT_MS || '30000', 10);
const MAX_PAGES = parseInt(process.env.MAX_INTERNAL_PAGES_BASIC || '6', 10);

const SCREENSHOT_WIDTH = 1920;
const SCREENSHOT_HEIGHT = 1080;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ASSET_EXTENSIONS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.zip', '.woff', '.woff2', '.ttf'];
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source', 'campaign', 'fbclid', 'gclid'];

// Phrases that indicate a blocked or error page — content is not readable evidence
const BLOCKED_PAGE_SIGNALS = [
  '403 forbidden',
  'access denied',
  'error 403',
  'cloudflare',
  'azion',
  'browser too old',
  'navegador muito antigo',
  'captcha',
  'verify you are human',
  'please verify',
  'ddos protection',
  'security check',
  'checking your browser',
  'enable javascript',
  'just a moment',
  'ray id',
];

// Selectors for cookie consent modals (used to detect visibility after accept attempt)
const CONSENT_OVERLAY_SELECTORS = [
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[class*="consent"]',
  '[id*="consent"]',
  '[class*="gdpr"]',
  '[id*="gdpr"]',
  '[class*="privacy-notice"]',
  '[id*="cookiebanner"]',
  '[class*="cookie-banner"]',
];

// Buttons to click — accept/positive only
const ACCEPT_BUTTON_TEXTS = [
  'Accept all', 'Accept All', 'Accept',
  'Agree', 'I agree',
  'Allow all', 'Allow All',
  'Consent',
  'Aceitar todos', 'Aceitar',
  'Concordo',
  'Permitir todos',
  'Tout accepter',
  'Alle akzeptieren', 'Akzeptieren',
  'Aceptar todo', 'Aceptar',
  'OK', 'Got it', 'I understand',
];

// Texts that must NOT be clicked (reject/settings buttons)
const REJECT_BUTTON_TEXTS = [
  'reject', 'decline', 'deny', 'manage', 'preference',
  'customize', 'settings', 'more options', 'rejeitar', 'recusar',
];

export class PlaywrightCrawlerProvider implements CaptureProvider {
  async capturePages(input: CaptureInput): Promise<CaptureResult[]> {
    const officialUrl = input.urls.find((u) => u.sectionKey === 'company_identity');
    if (!officialUrl) {
      return this.captureSimple(input);
    }

    console.log(`[PlaywrightCrawler] PLAYWRIGHT_CRAWL_STARTED: ${officialUrl.url}`);

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT },
        userAgent: USER_AGENT,
      });

      const results: CaptureResult[] = [];

      // Crawl official website homepage + internal pages
      const officialResults = await this.crawlOfficialSite(
        context,
        officialUrl,
        input.jobId,
        input.companyName
      );
      results.push(...officialResults);

      // Capture remaining non-official URLs
      const officialHostname = new URL(officialUrl.url).hostname;
      const externalUrls = input.urls.filter((u) => {
        try {
          return new URL(u.url).hostname !== officialHostname;
        } catch {
          return true;
        }
      });

      for (const urlInput of externalUrls) {
        const result = await this.captureSinglePage(context, urlInput, input.jobId);
        results.push(result);
      }

      await context.close();
      console.log(`[PlaywrightCrawler] PLAYWRIGHT_CRAWL_COMPLETED: ${results.filter((r) => r.status === 'success').length} pages captured`);
      return results;
    } catch (err) {
      console.error('[PlaywrightCrawler] Fatal error:', err);
      return input.urls.map((u) => ({
        sectionKey: u.sectionKey,
        sectionTitle: u.sectionTitle,
        sourceUrl: u.url,
        finalUrl: u.url,
        capturedAt: new Date().toISOString(),
        status: 'failed' as const,
        errorMessage: err instanceof Error ? err.message : 'Playwright crawl failed',
      }));
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  private async crawlOfficialSite(
    context: Awaited<ReturnType<Browser['newContext']>>,
    urlInput: { sectionKey: string; sectionTitle: string; url: string },
    jobId: string,
    companyName: string
  ): Promise<CaptureResult[]> {
    const results: CaptureResult[] = [];
    const page = await context.newPage();

    try {
      await page.goto(urlInput.url, { waitUntil: 'networkidle', timeout: TIMEOUT });
      await page.waitForTimeout(2000);

      await this.acceptCookieConsent(page);

      const homepageResult = await this.extractPageData(page, urlInput, jobId);
      results.push(homepageResult);

      if (homepageResult.status !== 'success') {
        return results;
      }

      console.log(`[PlaywrightCrawler] PLAYWRIGHT_HOMEPAGE_CAPTURED: ${homepageResult.finalUrl}`);

      const rawLinks = await page.$$eval('a[href]', (anchors) =>
        anchors.map((a) => (a as HTMLAnchorElement).href).filter((href) => href.startsWith('http'))
      );

      const normalizedLinks = this.normalizeLinks(rawLinks, urlInput.url);
      console.log(`[PlaywrightCrawler] PLAYWRIGHT_INTERNAL_LINKS_FOUND: ${normalizedLinks.length} same-domain links`);

      const candidates = classifyAndPrioritizeLinks(normalizedLinks, urlInput.url, MAX_PAGES);

      const extractedUrls = new Set(candidates.filter((c) => c.source === 'extracted').map((c) => c.url));
      const guessedCandidates = candidates.filter((c) => c.source === 'guessed');
      const validGuessed: InternalPageCandidate[] = [];

      for (const guess of guessedCandidates) {
        if (extractedUrls.has(guess.url)) continue;
        try {
          const checkPage = await context.newPage();
          const resp = await checkPage.goto(guess.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
          const status = resp?.status() || 0;
          await checkPage.close();
          console.log(`[PlaywrightCrawler] PLAYWRIGHT_GUESSED_URL_CHECKED: ${guess.url} -> ${status}`);
          if (status >= 200 && status < 400) {
            validGuessed.push(guess);
          }
        } catch {
          console.log(`[PlaywrightCrawler] PLAYWRIGHT_GUESSED_URL_CHECKED: ${guess.url} -> failed`);
        }
      }

      const pagesToCrawl = [
        ...candidates.filter((c) => c.source === 'extracted'),
        ...validGuessed,
      ].slice(0, MAX_PAGES);

      for (const candidate of pagesToCrawl) {
        console.log(`[PlaywrightCrawler] PLAYWRIGHT_IMPORTANT_LINKS_SELECTED: ${candidate.category} -> ${candidate.url}`);
      }

      for (const candidate of pagesToCrawl) {
        const internalResult = await this.crawlInternalPage(context, candidate, jobId, companyName);
        if (internalResult) {
          results.push(internalResult);
        }
      }
    } finally {
      await page.close();
    }

    return results;
  }

  private async crawlInternalPage(
    context: Awaited<ReturnType<Browser['newContext']>>,
    candidate: InternalPageCandidate,
    jobId: string,
    companyName: string
  ): Promise<CaptureResult | null> {
    const page = await context.newPage();
    try {
      await page.goto(candidate.url, { waitUntil: 'networkidle', timeout: TIMEOUT });
      await page.waitForTimeout(2000);
      await this.acceptCookieConsent(page);

      const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText).catch(() => '');

      // Relevance check
      const companyLower = companyName.toLowerCase();
      const textLower = text.toLowerCase();
      const isRelevant = textLower.includes(companyLower) ||
        textLower.includes(companyLower.replace(/\s+(ltd|inc|llc|corp|gmbh|ag|sa|bv|pty)\.?$/i, '').trim()) ||
        candidate.source === 'extracted';

      if (!isRelevant && text.length < 200) {
        console.log(`[PlaywrightCrawler] PLAYWRIGHT_PAGE_REJECTED: ${candidate.url} - insufficient relevant content`);
        return null;
      }

      // Check for blocked/error page
      const blockReason = this.detectBlockedPage(text, title);
      if (blockReason) {
        console.log(`[PlaywrightCrawler] PLAYWRIGHT_PAGE_BLOCKED: ${candidate.url} - ${blockReason}`);
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const screenshotUrl = await uploadScreenshot(jobId, candidate.url, Buffer.from(screenshotBuffer));
        return {
          sectionKey: candidate.sectionKey,
          sectionTitle: candidate.sectionTitle,
          sourceUrl: candidate.url,
          finalUrl: page.url(),
          pageTitle: title,
          screenshotUrl,
          extractedText: text.substring(0, 500),
          capturedAt: new Date().toISOString(),
          status: 'blocked',
          blockReason,
        };
      }

      // Check if cookie modal is still visible after accept attempt
      const modalStillVisible = await this.isCookieModalVisible(page);
      if (modalStillVisible) {
        console.log(`[PlaywrightCrawler] PLAYWRIGHT_COOKIE_MODAL_BLOCKING: ${candidate.url}`);
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const screenshotUrl = await uploadScreenshot(jobId, candidate.url, Buffer.from(screenshotBuffer));
        return {
          sectionKey: candidate.sectionKey,
          sectionTitle: candidate.sectionTitle,
          sourceUrl: candidate.url,
          finalUrl: page.url(),
          pageTitle: title,
          screenshotUrl,
          extractedText: text.substring(0, 500),
          capturedAt: new Date().toISOString(),
          status: 'blocked',
          blockReason: 'blocked_by_cookie_modal',
        };
      }

      const screenshotBuffer = await page.screenshot({ fullPage: false });
      const screenshotUrl = await uploadScreenshot(jobId, candidate.url, Buffer.from(screenshotBuffer));

      console.log(`[PlaywrightCrawler] PLAYWRIGHT_PAGE_CAPTURED: ${candidate.url} (${candidate.category})`);

      if (candidate.category === 'contact_address' && this.hasContactDetails(text)) {
        console.log(`[PlaywrightCrawler] PLAYWRIGHT_CONTACT_DETAILS_FOUND: ${candidate.url}`);
      }
      if (candidate.category === 'company_activity') {
        console.log(`[PlaywrightCrawler] PLAYWRIGHT_COMPANY_ACTIVITY_FOUND: ${candidate.url}`);
      }
      if (candidate.category === 'management' && this.hasManagementInfo(text)) {
        console.log(`[PlaywrightCrawler] PLAYWRIGHT_MANAGEMENT_FOUND: ${candidate.url}`);
      }

      return {
        sectionKey: candidate.sectionKey,
        sectionTitle: candidate.sectionTitle,
        sourceUrl: candidate.url,
        finalUrl: page.url(),
        pageTitle: title,
        screenshotUrl,
        extractedText: text.substring(0, 5000),
        capturedAt: new Date().toISOString(),
        status: 'success',
      };
    } catch (err) {
      console.log(`[PlaywrightCrawler] PLAYWRIGHT_PAGE_REJECTED: ${candidate.url} - ${err instanceof Error ? err.message : 'failed'}`);
      return null;
    } finally {
      await page.close();
    }
  }

  private async extractPageData(
    page: Page,
    urlInput: { sectionKey: string; sectionTitle: string; url: string },
    jobId: string
  ): Promise<CaptureResult> {
    try {
      const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText).catch(() => '');

      // Check for blocked/error page
      const blockReason = this.detectBlockedPage(text, title);
      if (blockReason) {
        console.log(`[PlaywrightCrawler] BLOCKED: ${urlInput.url} - ${blockReason}`);
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const screenshotUrl = await uploadScreenshot(jobId, urlInput.url, Buffer.from(screenshotBuffer));
        return {
          sectionKey: urlInput.sectionKey,
          sectionTitle: urlInput.sectionTitle,
          sourceUrl: urlInput.url,
          finalUrl: page.url(),
          pageTitle: title,
          screenshotUrl,
          extractedText: text.substring(0, 500),
          capturedAt: new Date().toISOString(),
          status: 'blocked',
          blockReason,
        };
      }

      // Check if cookie modal is still covering the page
      const modalStillVisible = await this.isCookieModalVisible(page);
      if (modalStillVisible) {
        console.log(`[PlaywrightCrawler] COOKIE_MODAL_BLOCKING: ${urlInput.url}`);
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const screenshotUrl = await uploadScreenshot(jobId, urlInput.url, Buffer.from(screenshotBuffer));
        return {
          sectionKey: urlInput.sectionKey,
          sectionTitle: urlInput.sectionTitle,
          sourceUrl: urlInput.url,
          finalUrl: page.url(),
          pageTitle: title,
          screenshotUrl,
          extractedText: text.substring(0, 500),
          capturedAt: new Date().toISOString(),
          status: 'blocked',
          blockReason: 'blocked_by_cookie_modal',
        };
      }

      const screenshotBuffer = await page.screenshot({ fullPage: false });
      const screenshotUrl = await uploadScreenshot(jobId, urlInput.url, Buffer.from(screenshotBuffer));

      return {
        sectionKey: urlInput.sectionKey,
        sectionTitle: urlInput.sectionTitle,
        sourceUrl: urlInput.url,
        finalUrl: page.url(),
        pageTitle: title,
        screenshotUrl,
        extractedText: text.substring(0, 5000),
        capturedAt: new Date().toISOString(),
        status: 'success',
      };
    } catch (err) {
      return {
        sectionKey: urlInput.sectionKey,
        sectionTitle: urlInput.sectionTitle,
        sourceUrl: urlInput.url,
        finalUrl: urlInput.url,
        capturedAt: new Date().toISOString(),
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'Page capture failed',
      };
    }
  }

  private async captureSinglePage(
    context: Awaited<ReturnType<Browser['newContext']>>,
    urlInput: { sectionKey: string; sectionTitle: string; url: string },
    jobId: string
  ): Promise<CaptureResult> {
    const page = await context.newPage();
    try {
      await page.goto(urlInput.url, { waitUntil: 'networkidle', timeout: TIMEOUT });
      await page.waitForTimeout(2000);
      await this.acceptCookieConsent(page);
      const result = await this.extractPageData(page, urlInput, jobId);
      return result;
    } catch (err) {
      return {
        sectionKey: urlInput.sectionKey,
        sectionTitle: urlInput.sectionTitle,
        sourceUrl: urlInput.url,
        finalUrl: urlInput.url,
        capturedAt: new Date().toISOString(),
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'Navigation failed',
      };
    } finally {
      await page.close();
    }
  }

  private async captureSimple(input: CaptureInput): Promise<CaptureResult[]> {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT },
        userAgent: USER_AGENT,
      });

      const results: CaptureResult[] = [];
      for (const urlInput of input.urls) {
        const result = await this.captureSinglePage(context, urlInput, input.jobId);
        results.push(result);
      }

      await context.close();
      return results;
    } catch (err) {
      return input.urls.map((u) => ({
        sectionKey: u.sectionKey,
        sectionTitle: u.sectionTitle,
        sourceUrl: u.url,
        finalUrl: u.url,
        capturedAt: new Date().toISOString(),
        status: 'failed' as const,
        errorMessage: err instanceof Error ? err.message : 'Playwright failed',
      }));
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  // Accept cookie consent using positive-only buttons. Never clicks reject/settings/manage.
  private async acceptCookieConsent(page: Page): Promise<void> {
    for (const text of ACCEPT_BUTTON_TEXTS) {
      try {
        const btn = page.locator(`button:has-text("${text}")`).first();
        if (!await btn.isVisible({ timeout: 600 }).catch(() => false)) continue;

        // Safety: verify this button doesn't contain reject-adjacent text
        const btnText = (await btn.textContent() || '').toLowerCase().trim();
        const isReject = REJECT_BUTTON_TEXTS.some((r) => btnText.includes(r));
        if (isReject) continue;

        await btn.click();
        await page.waitForTimeout(1200);
        console.log(`[PlaywrightCrawler] COOKIE_CONSENT_ACCEPTED: clicked "${text}"`);
        return;
      } catch { /* try next */ }
    }
  }

  // Returns true if a cookie/consent modal overlay is still blocking the page
  private async isCookieModalVisible(page: Page): Promise<boolean> {
    for (const selector of CONSENT_OVERLAY_SELECTORS) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 400 }).catch(() => false)) {
          return true;
        }
      } catch { /* continue */ }
    }
    return false;
  }

  // Returns a blockReason string if the page text/title indicates a blocked/error page
  private detectBlockedPage(text: string, title: string): string | null {
    const combined = (text + ' ' + title).toLowerCase();
    for (const signal of BLOCKED_PAGE_SIGNALS) {
      if (combined.includes(signal)) {
        return signal.replace(/\s+/g, '_');
      }
    }
    return null;
  }

  private normalizeLinks(rawLinks: string[], homepageUrl: string): string[] {
    const base = new URL(homepageUrl);
    const hostname = base.hostname;
    const seen = new Set<string>();
    const result: string[] = [];

    for (const raw of rawLinks) {
      try {
        const u = new URL(raw);
        if (u.hostname !== hostname) continue;
        if (u.pathname === '/' || u.pathname.length <= 1) continue;

        if (ASSET_EXTENSIONS.some((ext) => u.pathname.toLowerCase().endsWith(ext))) continue;

        for (const param of TRACKING_PARAMS) {
          u.searchParams.delete(param);
        }

        u.hash = '';

        const normalized = `${u.protocol}//${u.hostname}${u.pathname}`.replace(/\/+$/, '');
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
      } catch { /* skip invalid */ }
    }

    return result;
  }

  private hasContactDetails(text: string): boolean {
    const emailPattern = /[\w.-]+@[\w.-]+\.\w{2,}/;
    const phonePattern = /[\+]?[\d\s\-\(\)]{7,}/;
    const addressPattern = /\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|blvd|drive|dr|lane|ln|way|place|pl|court|ct)/i;
    return emailPattern.test(text) || phonePattern.test(text) || addressPattern.test(text);
  }

  private hasManagementInfo(text: string): boolean {
    const patterns = /(?:CEO|CTO|CFO|COO|founder|president|director|executive|vice president|managing director|chief)/i;
    return patterns.test(text);
  }
}
