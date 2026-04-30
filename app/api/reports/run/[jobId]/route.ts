import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { discoverCompanySources } from '@/lib/source-discovery';
import { ApifyCaptureProvider } from '@/lib/browser-capture/apify-provider';
import { MockCaptureProvider } from '@/lib/browser-capture/mock-provider';
import { PlaywrightCrawlerProvider } from '@/lib/browser-capture/playwright-provider';
import { analyzeEvidence, analyzeSerpSnippet } from '@/lib/ai/analyze-evidence';
import { generateStructuredReport } from '@/lib/ai/generate-report';
import { identifyGapsAndSearch } from '@/lib/ai/gap-search';
import { generateSummary } from '@/lib/report-summary';
import { CaptureProvider, CaptureResult } from '@/lib/browser-capture/capture-provider';
import { isRelevantToCompany, isHighValueFailedSource } from '@/lib/relevance';
import { discoverImportantInternalPages } from '@/lib/internal-pages';
import { runApifyEnrichment } from '@/lib/apify/enrichment-orchestrator';
import { runTargetedSectionSearches, pickCaptureTargets } from '@/lib/ai/targeted-section-search';
import { NextResponse } from 'next/server';

export const maxDuration = 300;

function getCaptureProvider(): { provider: CaptureProvider; isPlaywright: boolean } {
  if (process.env.ENABLE_DIRECT_PLAYWRIGHT_CRAWLER === 'true') {
    try {
      require('playwright');
      console.log('[RunJob] Using Playwright direct crawler');
      return { provider: new PlaywrightCrawlerProvider(), isPlaywright: true };
    } catch {
      console.warn('[RunJob] Playwright not available, falling back to Apify');
    }
  }
  if (process.env.APIFY_TOKEN && process.env.APIFY_WEB_SEARCH_ACTOR_ID) {
    return { provider: new ApifyCaptureProvider(), isPlaywright: false };
  }
  console.warn('[RunJob] No Apify config, using mock capture');
  return { provider: new MockCaptureProvider(), isPlaywright: false };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: job } = await admin
      .from('web_search_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single();

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    let officialDomain: string | null = null;
    if (job.official_website_input) {
      try {
        officialDomain = new URL(job.official_website_input).hostname.replace(/^www\./, '');
      } catch { /* ignore */ }
    }

    // Step 1: Discover sources via Brave Search
    await admin
      .from('web_search_jobs')
      .update({ status: 'discovering_sources', progress_step: 'Searching for public sources...' })
      .eq('id', jobId);

    const sources = await discoverCompanySources({
      companyName: job.company_name,
      country: job.country,
      officialWebsite: job.official_website_input,
    });

    const capturableSources = sources.filter((s) => s.shouldCapture);
    const serpOnlySources = sources.filter((s) => !s.shouldCapture);

    console.log(`[RunJob] ${sources.length} sources (${capturableSources.length} capturable, ${serpOnlySources.length} SERP-only)`);

    for (const source of sources) {
      await admin.from('web_search_sources').insert({
        job_id: jobId,
        section_key: source.sectionKey,
        section_title: source.sectionTitle,
        source_url: source.sourceUrl,
        source_type: source.sourceType,
        discovery_method: source.reason,
        selected: source.shouldCapture,
      });
    }

    // Step 2: Capture pages + Apify enrichment IN PARALLEL
    await admin
      .from('web_search_jobs')
      .update({ status: 'capturing_screenshots', progress_step: `Capturing ${capturableSources.length} pages...` })
      .eq('id', jobId);

    const { provider: captureProvider, isPlaywright } = getCaptureProvider();

    const [captureResults, apifyEnrichmentResults] = await Promise.all([
      captureProvider.capturePages({
        jobId,
        companyName: job.company_name,
        country: job.country,
        urls: capturableSources.map((s) => ({
          sectionKey: s.sectionKey,
          sectionTitle: s.sectionTitle,
          url: s.sourceUrl,
        })),
      }),
      runApifyEnrichment({
        companyName: job.company_name,
        country: job.country,
        officialWebsite: job.official_website_input,
        jobId,
        alreadyCapturedUrls: new Set(capturableSources.map((s) => s.sourceUrl)),
      }).catch((err) => {
        console.error('[RunJob] Apify enrichment failed (non-blocking):', err);
        return [] as CaptureResult[];
      }),
    ]);

    // Step 2b: Internal page discovery from official website
    // Skip if Playwright already handled internal page discovery
    let internalPageResults: CaptureResult[] = [];

    if (!isPlaywright) {
      const officialCapture = captureResults.find(
        (r) => r.status === 'success' && r.sectionKey === 'company_identity' && r.extractedText
      );

      if (officialCapture && officialCapture.extractedText) {
        console.log(`[RunJob] OFFICIAL_SITE_CAPTURED: ${officialCapture.sourceUrl}`);

        await admin
          .from('web_search_jobs')
          .update({ progress_step: 'Discovering internal pages...' })
          .eq('id', jobId);

        const internalPages = discoverImportantInternalPages(
          officialCapture.sourceUrl,
          officialCapture.extractedText,
          6
        );

        if (internalPages.length > 0) {
          const alreadyCaptured = new Set(captureResults.map((r) => r.sourceUrl));
          const newPages = internalPages.filter((p) => !alreadyCaptured.has(p.url));

          if (newPages.length > 0) {
            console.log(`[RunJob] Capturing ${newPages.length} internal pages...`);
            await admin
              .from('web_search_jobs')
              .update({ progress_step: `Capturing ${newPages.length} internal pages...` })
              .eq('id', jobId);

            internalPageResults = await captureProvider.capturePages({
              jobId,
              companyName: job.company_name,
              country: job.country,
              urls: newPages.map((p) => ({
                sectionKey: p.sectionKey,
                sectionTitle: p.sectionTitle,
                url: p.url,
              })),
            });

            for (const page of newPages) {
              await admin.from('web_search_sources').insert({
                job_id: jobId,
                section_key: page.sectionKey,
                section_title: page.sectionTitle,
                source_url: page.url,
                source_type: 'internal_page',
                discovery_method: `Internal page (${page.source}): ${page.category}`,
                selected: true,
              });
            }
          }
        }
      }
    } else {
      // With Playwright, internal pages are already included in captureResults
      // Save internal page sources to DB (pages beyond the homepage)
      const officialUrl = capturableSources.find((s) => s.sectionKey === 'company_identity');
      if (officialUrl) {
        const officialHostname = new URL(officialUrl.sourceUrl).hostname;
        const internalResults = captureResults.filter((r) => {
          if (r.status !== 'success') return false;
          if (r.sourceUrl === officialUrl.sourceUrl) return false;
          try {
            return new URL(r.sourceUrl).hostname === officialHostname;
          } catch { return false; }
        });

        for (const result of internalResults) {
          await admin.from('web_search_sources').insert({
            job_id: jobId,
            section_key: result.sectionKey,
            section_title: result.sectionTitle,
            source_url: result.sourceUrl,
            source_type: 'internal_page',
            discovery_method: 'Playwright internal page crawl',
            selected: true,
          });
        }
      }
    }

    // Deduplicate by URL, preferring entries with screenshots
    const seenUrls = new Map<string, CaptureResult>();
    for (const result of [...captureResults, ...internalPageResults, ...apifyEnrichmentResults]) {
      const existing = seenUrls.get(result.sourceUrl);
      if (!existing) {
        seenUrls.set(result.sourceUrl, result);
      } else if (!existing.screenshotUrl && result.screenshotUrl) {
        seenUrls.set(result.sourceUrl, result);
      }
    }
    const allCaptureResults = Array.from(seenUrls.values());
    const checkedSections = new Set<string>();

    // Save Apify enrichment sources to DB
    for (const result of apifyEnrichmentResults) {
      if (result.status === 'success') {
        await admin.from('web_search_sources').insert({
          job_id: jobId,
          section_key: result.sectionKey,
          section_title: result.sectionTitle,
          source_url: result.sourceUrl,
          source_type: 'apify_enrichment',
          discovery_method: `Apify enrichment: ${result.pageTitle || result.sourceUrl}`,
          selected: true,
        });
      }
    }

    // Step 2c: Targeted SERP searches for Corporate Group and Government Connections
    // These always run, ensuring SERP evidence and screenshot attempts exist even if main
    // capture found nothing for these sections.
    await admin
      .from('web_search_jobs')
      .update({ progress_step: 'Searching corporate group and government connections...' })
      .eq('id', jobId);

    const targetedSearchResults = await runTargetedSectionSearches({
      companyName: job.company_name,
      country: job.country,
    }).catch((err) => {
      console.error('[RunJob] Targeted section searches failed (non-blocking):', err);
      return { corporate_group: [], government_connections: [] } as { corporate_group: never[]; government_connections: never[] };
    });

    const allTargetedSerpResults = [
      ...targetedSearchResults.corporate_group,
      ...targetedSearchResults.government_connections,
    ];

    // Attempt screenshot capture for best non-blocked candidates
    const groupCaptureTargets = pickCaptureTargets(targetedSearchResults.corporate_group, 2);
    const govCaptureTargets = pickCaptureTargets(targetedSearchResults.government_connections, 2);
    const targetedCaptureUrls = [...groupCaptureTargets, ...govCaptureTargets];

    let targetedCaptureResults: CaptureResult[] = [];
    if (targetedCaptureUrls.length > 0) {
      console.log(`[RunJob] Attempting targeted captures for ${targetedCaptureUrls.length} corporate/gov URLs`);
      targetedCaptureResults = await captureProvider.capturePages({
        jobId,
        companyName: job.company_name,
        country: job.country,
        urls: targetedCaptureUrls,
      }).catch((err) => {
        console.error('[RunJob] Targeted capture failed (non-blocking):', err);
        return [] as CaptureResult[];
      });

      // Add targeted capture sources to DB
      for (const target of targetedCaptureUrls) {
        await admin.from('web_search_sources').insert({
          job_id: jobId,
          section_key: target.sectionKey,
          section_title: target.sectionTitle,
          source_url: target.url,
          source_type: 'gap_search',
          discovery_method: 'Targeted section search (corporate group / government)',
          selected: true,
        });
      }
    }

    // Step 3: Analyze evidence
    await admin
      .from('web_search_jobs')
      .update({ status: 'analyzing', progress_step: 'Analyzing evidence...' })
      .eq('id', jobId);

    let capturedCount = 0;
    let rejectedCount = 0;
    const collectedEvidence: {
      sectionKey: string; sectionTitle: string; sourceUrl: string;
      pageTitle?: string; screenshotUrl?: string; extractedText?: string;
      snippet?: string; captureStatus: string; aiComment?: string;
      evidenceBullets?: string[]; confidence?: string; flags?: string[];
    }[] = [];

    for (const capture of allCaptureResults) {
      checkedSections.add(capture.sectionKey);

      if (capture.status === 'success') {
        const isInternal = internalPageResults.includes(capture) || (
          isPlaywright && officialDomain && (() => {
            try { return new URL(capture.sourceUrl).hostname.replace(/^www\./, '') === officialDomain; } catch { return false; }
          })()
        );

        if (!isInternal) {
          const relevance = isRelevantToCompany(
            { url: capture.sourceUrl, title: capture.pageTitle || '', snippet: '', extractedText: capture.extractedText },
            job.company_name, officialDomain
          );
          if (!relevance.relevant) {
            rejectedCount++;
            console.log(`[RunJob] REJECTED: ${capture.sourceUrl} - ${relevance.reason}`);
            continue;
          }
        }

        const analysis = await analyzeEvidence({
          sectionKey: capture.sectionKey,
          sectionTitle: capture.sectionTitle,
          sourceUrl: capture.sourceUrl,
          pageTitle: capture.pageTitle,
          extractedText: capture.extractedText,
          companyName: job.company_name,
        });

        // Reject if AI says irrelevant (skip for internal pages)
        if (!isInternal) {
          const comment = (analysis.aiComment || '').toLowerCase();
          const aiSaysIrrelevant = comment.includes('does not contain') || comment.includes('not mentioned') || comment.includes('no information about');
          if (aiSaysIrrelevant && analysis.confidence === 'Low') {
            rejectedCount++;
            continue;
          }
        }

        // Stricter validation for ownership_management: must mention target company
        if (capture.sectionKey === 'ownership_management' && !isInternal) {
          const text = (capture.extractedText || '').toLowerCase();
          const title = (capture.pageTitle || '').toLowerCase();
          const companyWords = job.company_name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
          const hasCompanyInText = companyWords.some((w: string) => text.includes(w) || title.includes(w));
          const hasManagementFlag = analysis.flags.includes('management_found') || analysis.flags.includes('ownership_found');
          if (!hasCompanyInText && !hasManagementFlag) {
            rejectedCount++;
            console.log(`[RunJob] REJECTED (ownership no company match): ${capture.sourceUrl}`);
            continue;
          }
          if (!hasCompanyInText && analysis.confidence === 'Low') {
            rejectedCount++;
            console.log(`[RunJob] REJECTED (ownership low confidence): ${capture.sourceUrl}`);
            continue;
          }
        }

        const { data: srcRec } = await admin
          .from('web_search_sources').select('id')
          .eq('job_id', jobId).eq('source_url', capture.sourceUrl).single();

        await admin.from('web_search_evidence').insert({
          job_id: jobId,
          source_id: srcRec?.id || null,
          section_key: capture.sectionKey,
          section_title: capture.sectionTitle,
          source_url: capture.sourceUrl,
          page_title: capture.pageTitle,
          screenshot_url: capture.screenshotUrl || null,
          extracted_text: capture.extractedText || null,
          ai_comment: analysis.aiComment,
          evidence_bullets: analysis.evidenceBullets,
          confidence: analysis.confidence,
          flags: analysis.flags,
          capture_status: 'captured',
          error_message: null,
          captured_at: capture.capturedAt,
        });

        capturedCount++;
        collectedEvidence.push({
          sectionKey: capture.sectionKey, sectionTitle: capture.sectionTitle,
          sourceUrl: capture.sourceUrl, pageTitle: capture.pageTitle,
          screenshotUrl: capture.screenshotUrl, extractedText: capture.extractedText,
          captureStatus: 'captured', aiComment: analysis.aiComment,
          evidenceBullets: analysis.evidenceBullets, confidence: analysis.confidence,
          flags: analysis.flags,
        });
      } else if (capture.status === 'blocked') {
        // Blocked pages (403, captcha, cookie modal, cloudflare) — save as blocked_source,
        // never count as Found, never contribute flags to evidence aggregation
        console.log(`[RunJob] BLOCKED_SOURCE: ${capture.sourceUrl} - ${capture.blockReason}`);

        const { data: srcRec } = await admin
          .from('web_search_sources').select('id')
          .eq('job_id', jobId).eq('source_url', capture.sourceUrl).single();

        await admin.from('web_search_evidence').insert({
          job_id: jobId, source_id: srcRec?.id || null,
          section_key: capture.sectionKey, section_title: capture.sectionTitle,
          source_url: capture.sourceUrl,
          page_title: capture.pageTitle || null,
          screenshot_url: capture.screenshotUrl || null,
          extracted_text: null,
          ai_comment: 'Source reached but content was blocked or not visible.',
          evidence_bullets: null,
          confidence: 'Low',
          flags: null,
          capture_status: 'blocked_source',
          error_message: capture.blockReason || 'Page blocked',
          captured_at: capture.capturedAt,
        });
      } else {
        // Failed — only save high-value
        const src = capturableSources.find((s) => s.sourceUrl === capture.sourceUrl);
        const highValue = isHighValueFailedSource(
          { url: capture.sourceUrl, title: src?.reason.replace('Brave Search: ', '') || '', snippet: src?.snippet || '', sectionKey: capture.sectionKey, category: src?.category },
          job.company_name, officialDomain
        );
        if (highValue) {
          const { data: srcRec } = await admin
            .from('web_search_sources').select('id')
            .eq('job_id', jobId).eq('source_url', capture.sourceUrl).single();

          await admin.from('web_search_evidence').insert({
            job_id: jobId, source_id: srcRec?.id || null,
            section_key: capture.sectionKey, section_title: capture.sectionTitle,
            source_url: capture.sourceUrl,
            page_title: src?.reason.replace('Brave Search: ', '') || null,
            screenshot_url: null, extracted_text: null,
            ai_comment: null, evidence_bullets: null, confidence: null, flags: null,
            capture_status: 'failed',
            error_message: capture.errorMessage || 'Page not captured',
            captured_at: capture.capturedAt,
          });
        }
      }
    }

    // Analyze SERP-only sources
    for (const serpSource of serpOnlySources) {
      if (!serpSource.snippet) continue;
      checkedSections.add(serpSource.sectionKey);

      const analysis = await analyzeSerpSnippet({
        sectionKey: serpSource.sectionKey,
        sectionTitle: serpSource.sectionTitle,
        sourceUrl: serpSource.sourceUrl,
        title: serpSource.reason.replace('Brave Search: ', ''),
        snippet: serpSource.snippet,
        companyName: job.company_name,
      });

      const { data: srcRec } = await admin
        .from('web_search_sources').select('id')
        .eq('job_id', jobId).eq('source_url', serpSource.sourceUrl).single();

      await admin.from('web_search_evidence').insert({
        job_id: jobId, source_id: srcRec?.id || null,
        section_key: serpSource.sectionKey, section_title: serpSource.sectionTitle,
        source_url: serpSource.sourceUrl,
        page_title: serpSource.reason.replace('Brave Search: ', ''),
        screenshot_url: null, extracted_text: serpSource.snippet,
        ai_comment: analysis.aiComment, evidence_bullets: analysis.evidenceBullets,
        confidence: analysis.confidence, flags: analysis.flags,
        capture_status: 'search_only', error_message: null,
        captured_at: new Date().toISOString(),
      });

      collectedEvidence.push({
        sectionKey: serpSource.sectionKey, sectionTitle: serpSource.sectionTitle,
        sourceUrl: serpSource.sourceUrl, snippet: serpSource.snippet,
        captureStatus: 'search_only', aiComment: analysis.aiComment,
        evidenceBullets: analysis.evidenceBullets, confidence: analysis.confidence,
        flags: analysis.flags,
      });
    }

    // Process targeted section search captures (corporate group + government connections)
    for (const capture of targetedCaptureResults) {
      checkedSections.add(capture.sectionKey);

      if (capture.status === 'success') {
        const analysis = await analyzeEvidence({
          sectionKey: capture.sectionKey,
          sectionTitle: capture.sectionTitle,
          sourceUrl: capture.sourceUrl,
          pageTitle: capture.pageTitle,
          extractedText: capture.extractedText,
          companyName: job.company_name,
        });

        const { data: srcRec } = await admin
          .from('web_search_sources').select('id')
          .eq('job_id', jobId).eq('source_url', capture.sourceUrl).single();

        await admin.from('web_search_evidence').insert({
          job_id: jobId, source_id: srcRec?.id || null,
          section_key: capture.sectionKey, section_title: capture.sectionTitle,
          source_url: capture.sourceUrl, page_title: capture.pageTitle,
          screenshot_url: capture.screenshotUrl || null,
          extracted_text: capture.extractedText || null,
          ai_comment: analysis.aiComment,
          evidence_bullets: analysis.evidenceBullets,
          confidence: analysis.confidence,
          flags: analysis.flags,
          capture_status: 'captured',
          error_message: null,
          captured_at: capture.capturedAt,
        });

        capturedCount++;
        collectedEvidence.push({
          sectionKey: capture.sectionKey, sectionTitle: capture.sectionTitle,
          sourceUrl: capture.sourceUrl, pageTitle: capture.pageTitle,
          screenshotUrl: capture.screenshotUrl, extractedText: capture.extractedText,
          captureStatus: 'captured', aiComment: analysis.aiComment,
          evidenceBullets: analysis.evidenceBullets, confidence: analysis.confidence,
          flags: analysis.flags,
        });
      } else if (capture.status === 'blocked') {
        const { data: srcRec } = await admin
          .from('web_search_sources').select('id')
          .eq('job_id', jobId).eq('source_url', capture.sourceUrl).single();

        await admin.from('web_search_evidence').insert({
          job_id: jobId, source_id: srcRec?.id || null,
          section_key: capture.sectionKey, section_title: capture.sectionTitle,
          source_url: capture.sourceUrl, page_title: capture.pageTitle,
          screenshot_url: capture.screenshotUrl || null,
          extracted_text: null,
          ai_comment: 'Source reached but content was blocked or not visible.',
          evidence_bullets: null, confidence: 'Low', flags: null,
          capture_status: 'blocked_source',
          error_message: capture.blockReason || 'Page blocked',
          captured_at: capture.capturedAt,
        });
      }
    }

    // Save targeted SERP-only results for corporate group and government connections
    // (deduplicate against URLs already captured or already seen as SERP)
    const seenEvidenceUrls = new Set(collectedEvidence.map((e) => e.sourceUrl));
    for (const serp of allTargetedSerpResults) {
      checkedSections.add(serp.sectionKey);
      if (seenEvidenceUrls.has(serp.sourceUrl)) continue;
      seenEvidenceUrls.add(serp.sourceUrl);

      await admin.from('web_search_sources').insert({
        job_id: jobId,
        section_key: serp.sectionKey,
        section_title: serp.sectionTitle,
        source_url: serp.sourceUrl,
        source_type: 'brave_search',
        discovery_method: `Targeted section search: ${serp.sectionTitle}`,
        selected: false,
      });

      const { data: srcRec } = await admin
        .from('web_search_sources').select('id')
        .eq('job_id', jobId).eq('source_url', serp.sourceUrl).single();

      await admin.from('web_search_evidence').insert({
        job_id: jobId, source_id: srcRec?.id || null,
        section_key: serp.sectionKey, section_title: serp.sectionTitle,
        source_url: serp.sourceUrl, page_title: serp.pageTitle,
        screenshot_url: null, extracted_text: serp.snippet,
        ai_comment: serp.aiComment,
        evidence_bullets: serp.evidenceBullets,
        confidence: serp.confidence,
        flags: serp.flags,
        capture_status: 'search_only',
        error_message: null,
        captured_at: new Date().toISOString(),
      });

      collectedEvidence.push({
        sectionKey: serp.sectionKey, sectionTitle: serp.sectionTitle,
        sourceUrl: serp.sourceUrl, snippet: serp.snippet,
        captureStatus: 'search_only', aiComment: serp.aiComment,
        evidenceBullets: serp.evidenceBullets, confidence: serp.confidence,
        flags: serp.flags,
      });
    }

    // Step 3b: Gap search — Claude identifies missing areas, Brave finds URLs, Playwright captures
    await admin
      .from('web_search_jobs')
      .update({ progress_step: 'Searching for missing evidence...' })
      .eq('id', jobId);

    const gapUrls = await identifyGapsAndSearch({
      companyName: job.company_name,
      country: job.country,
      coveredSections: checkedSections,
      collectedEvidence: collectedEvidence.map((e) => ({ sectionKey: e.sectionKey, captureStatus: e.captureStatus })),
    });

    if (gapUrls.length > 0) {
      console.log(`[RunJob] Gap search: capturing ${gapUrls.length} external pages`);
      await admin
        .from('web_search_jobs')
        .update({ progress_step: `Capturing ${gapUrls.length} gap-fill pages...` })
        .eq('id', jobId);

      const gapCaptureResults = await captureProvider.capturePages({
        jobId,
        companyName: job.company_name,
        country: job.country,
        urls: gapUrls.map((g) => ({
          sectionKey: g.sectionKey,
          sectionTitle: g.sectionTitle,
          url: g.url,
        })),
      });

      for (const capture of gapCaptureResults) {
        if (capture.status === 'success') {
          checkedSections.add(capture.sectionKey);

          const analysis = await analyzeEvidence({
            sectionKey: capture.sectionKey,
            sectionTitle: capture.sectionTitle,
            sourceUrl: capture.sourceUrl,
            pageTitle: capture.pageTitle,
            extractedText: capture.extractedText,
            companyName: job.company_name,
          });

          // Stricter validation for ownership_management in gap search too
          if (capture.sectionKey === 'ownership_management') {
            const text = (capture.extractedText || '').toLowerCase();
            const title = (capture.pageTitle || '').toLowerCase();
            const companyWords = job.company_name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
            const hasCompanyInText = companyWords.some((w: string) => text.includes(w) || title.includes(w));
            const hasManagementFlag = analysis.flags.includes('management_found') || analysis.flags.includes('ownership_found');
            if (!hasCompanyInText && !hasManagementFlag) {
              console.log(`[RunJob] REJECTED gap (ownership no company match): ${capture.sourceUrl}`);
              continue;
            }
            if (!hasCompanyInText && analysis.confidence === 'Low') {
              console.log(`[RunJob] REJECTED gap (ownership low confidence): ${capture.sourceUrl}`);
              continue;
            }
          }

          await admin.from('web_search_sources').insert({
            job_id: jobId,
            section_key: capture.sectionKey,
            section_title: capture.sectionTitle,
            source_url: capture.sourceUrl,
            source_type: 'gap_search',
            discovery_method: 'AI gap analysis + Brave Search',
            selected: true,
          });

          const { data: srcRec } = await admin
            .from('web_search_sources').select('id')
            .eq('job_id', jobId).eq('source_url', capture.sourceUrl).single();

          await admin.from('web_search_evidence').insert({
            job_id: jobId,
            source_id: srcRec?.id || null,
            section_key: capture.sectionKey,
            section_title: capture.sectionTitle,
            source_url: capture.sourceUrl,
            page_title: capture.pageTitle,
            screenshot_url: capture.screenshotUrl || null,
            extracted_text: capture.extractedText || null,
            ai_comment: analysis.aiComment,
            evidence_bullets: analysis.evidenceBullets,
            confidence: analysis.confidence,
            flags: analysis.flags,
            capture_status: 'captured',
            error_message: null,
            captured_at: capture.capturedAt,
          });

          capturedCount++;
          collectedEvidence.push({
            sectionKey: capture.sectionKey, sectionTitle: capture.sectionTitle,
            sourceUrl: capture.sourceUrl, pageTitle: capture.pageTitle,
            screenshotUrl: capture.screenshotUrl, extractedText: capture.extractedText,
            captureStatus: 'captured', aiComment: analysis.aiComment,
            evidenceBullets: analysis.evidenceBullets, confidence: analysis.confidence,
            flags: analysis.flags,
          });
        }
      }
    }

    // Mark key sections as checked (search was attempted even if nothing found)
    checkedSections.add('government_connections');
    checkedSections.add('corporate_group');
    checkedSections.add('public_registry');
    checkedSections.add('ownership_management');

    // Step 4: Generate structured report via Claude
    await admin
      .from('web_search_jobs')
      .update({ progress_step: 'Generating report...' })
      .eq('id', jobId);

    const structuredReport = await generateStructuredReport({
      companyName: job.company_name,
      country: job.country,
      officialWebsite: job.official_website_input,
      evidence: collectedEvidence,
    });

    // Step 5: Generate summary + coverage
    const { data: allEvidence } = await admin
      .from('web_search_evidence')
      .select('section_key, capture_status, confidence, flags')
      .eq('job_id', jobId);

    const { summary, finalComment, coverage } = generateSummary(
      allEvidence || [],
      checkedSections,
      !!job.official_website_input
    );

    const finalAssessment = structuredReport?.finalAssessment || finalComment;

    await admin
      .from('web_search_jobs')
      .update({
        status: 'completed',
        progress_step: null,
        summary_json: { ...summary },
        final_comment: finalAssessment,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await admin.from('report_activity').insert({
      job_id: jobId, user_id: user.id,
      activity_type: 'job_completed',
      message: `Report completed: ${capturedCount} captured, ${serpOnlySources.length} SERP, ${rejectedCount} rejected.`,
    });

    return NextResponse.json({ success: true, jobId });
  } catch (err) {
    console.error('[API] /reports/run error:', err);
    const admin = createAdminClient();
    await admin.from('web_search_jobs').update({
      status: 'failed', error_message: err instanceof Error ? err.message : 'Unknown error', progress_step: null,
    }).eq('id', jobId);
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 });
  }
}
