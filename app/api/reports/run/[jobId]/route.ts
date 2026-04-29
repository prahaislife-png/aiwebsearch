import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { discoverCompanySources } from '@/lib/source-discovery';
import { ApifyCaptureProvider } from '@/lib/browser-capture/apify-provider';
import { MockCaptureProvider } from '@/lib/browser-capture/mock-provider';
import { analyzeEvidence, analyzeSerpSnippet } from '@/lib/ai/analyze-evidence';
import { generateSummary } from '@/lib/report-summary';
import { CaptureProvider, CaptureResult } from '@/lib/browser-capture/capture-provider';
import { isRelevantToCompany, isHighValueFailedSource } from '@/lib/relevance';
import { discoverImportantInternalPages } from '@/lib/internal-pages';
import { NextResponse } from 'next/server';

export const maxDuration = 300;

function getCaptureProvider(): CaptureProvider {
  if (process.env.APIFY_TOKEN && process.env.APIFY_WEB_SEARCH_ACTOR_ID) {
    return new ApifyCaptureProvider();
  }
  console.warn('[RunJob] No Apify config, using mock capture');
  return new MockCaptureProvider();
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

    // Detect official domain
    let officialDomain: string | null = null;
    if (job.official_website_input) {
      try {
        officialDomain = new URL(job.official_website_input).hostname.replace(/^www\./, '');
      } catch { /* ignore */ }
    }

    // Step 1: Discover sources via Google SERP (with relevance filtering built in)
    await admin
      .from('web_search_jobs')
      .update({ status: 'discovering_sources', progress_step: 'Searching Google for public sources...' })
      .eq('id', jobId);

    const sources = await discoverCompanySources({
      companyName: job.company_name,
      country: job.country,
      officialWebsite: job.official_website_input,
      reportType: job.report_type,
    });

    const capturableSources = sources.filter((s) => s.shouldCapture);
    const serpOnlySources = sources.filter((s) => !s.shouldCapture);

    console.log(`[RunJob] Discovered ${sources.length} relevant sources (${capturableSources.length} capturable, ${serpOnlySources.length} SERP-only)`);

    // Store discovered sources
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

    // Step 2: Capture pages (only capturable URLs that passed relevance)
    await admin
      .from('web_search_jobs')
      .update({ status: 'capturing_screenshots', progress_step: `Capturing ${capturableSources.length} pages...` })
      .eq('id', jobId);

    const captureProvider = getCaptureProvider();
    let captureResults = await captureProvider.capturePages({
      jobId,
      companyName: job.company_name,
      country: job.country,
      urls: capturableSources.map((s) => ({
        sectionKey: s.sectionKey,
        sectionTitle: s.sectionTitle,
        url: s.sourceUrl,
      })),
    });

    // Step 2b: Internal page discovery from official website
    const officialWebsiteCapture = captureResults.find(
      (r) => r.status === 'success' && r.sectionKey === 'official_website' && r.extractedText
    );

    let internalPageResults: CaptureResult[] = [];

    if (officialWebsiteCapture && officialWebsiteCapture.extractedText) {
      console.log(`[RunJob] OFFICIAL_SITE_CAPTURED: ${officialWebsiteCapture.sourceUrl}`);

      await admin
        .from('web_search_jobs')
        .update({ progress_step: 'Discovering internal pages...' })
        .eq('id', jobId);

      const maxInternalPages = job.report_type === 'basic' || job.report_type === 'BASIC' ? 6 : 10;
      const internalPages = discoverImportantInternalPages(
        officialWebsiteCapture.sourceUrl,
        officialWebsiteCapture.extractedText,
        maxInternalPages
      );

      if (internalPages.length > 0) {
        // Filter out pages already in capture list
        const alreadyCapturedUrls = new Set(captureResults.map((r) => r.sourceUrl));
        const newInternalPages = internalPages.filter((p) => !alreadyCapturedUrls.has(p.url));

        if (newInternalPages.length > 0) {
          console.log(`[RunJob] Capturing ${newInternalPages.length} internal pages...`);

          await admin
            .from('web_search_jobs')
            .update({ progress_step: `Capturing ${newInternalPages.length} internal pages...` })
            .eq('id', jobId);

          internalPageResults = await captureProvider.capturePages({
            jobId,
            companyName: job.company_name,
            country: job.country,
            urls: newInternalPages.map((p) => ({
              sectionKey: p.sectionKey,
              sectionTitle: p.sectionTitle,
              url: p.url,
            })),
          });

          for (const result of internalPageResults) {
            if (result.status === 'success') {
              console.log(`[RunJob] IMPORTANT_INTERNAL_PAGE_CAPTURE_SUCCESS: ${result.sourceUrl}`);
            } else {
              console.log(`[RunJob] IMPORTANT_INTERNAL_PAGE_CAPTURE_FAILED: ${result.sourceUrl}`);
            }
          }

          // Store internal page sources
          for (const page of newInternalPages) {
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

    // Combine all capture results
    const allCaptureResults = [...captureResults, ...internalPageResults];

    // Track which section_keys have been checked
    const checkedSections = new Set<string>();

    // Step 3: Analyze captured evidence with post-capture relevance validation
    await admin
      .from('web_search_jobs')
      .update({ status: 'analyzing', progress_step: 'Analyzing captured evidence...' })
      .eq('id', jobId);

    let capturedCount = 0;
    let rejectedCount = 0;
    let failedHighValue = 0;
    let failedHidden = 0;

    for (const capture of allCaptureResults) {
      checkedSections.add(capture.sectionKey);

      if (capture.status === 'success') {
        // Post-capture relevance check — skip for internal pages (they're on the official domain)
        const isInternalPage = internalPageResults.includes(capture);
        if (!isInternalPage) {
          const postRelevance = isRelevantToCompany(
            {
              url: capture.sourceUrl,
              title: capture.pageTitle || '',
              snippet: '',
              extractedText: capture.extractedText,
            },
            job.company_name,
            officialDomain
          );

          if (!postRelevance.relevant) {
            rejectedCount++;
            console.log(`[RunJob] REJECTED_IRRELEVANT_SOURCE (post-capture): ${capture.sourceUrl} - ${postRelevance.reason}`);
            continue;
          }
        }

        // Analyze the captured page
        const analysis = await analyzeEvidence({
          sectionKey: capture.sectionKey,
          sectionTitle: capture.sectionTitle,
          sourceUrl: capture.sourceUrl,
          pageTitle: capture.pageTitle,
          extractedText: capture.extractedText,
          companyName: job.company_name,
        });

        // Check if AI analysis says the page is irrelevant (skip for internal pages)
        if (!isInternalPage) {
          const aiComment = (analysis.aiComment || '').toLowerCase();
          const isAiRejected =
            aiComment.includes('does not contain') ||
            aiComment.includes('not mentioned') ||
            aiComment.includes('not related to') ||
            aiComment.includes('no information about') ||
            (analysis.flags.includes('manual_review_needed') && !analysis.flags.some(f =>
              f === 'website_identified' || f === 'company_activity_found' ||
              f === 'operational_address_found' || f === 'registry_found' ||
              f === 'management_found' || f === 'parent_company_found'
            ));

          if (isAiRejected && analysis.confidence === 'Low') {
            rejectedCount++;
            console.log(`[RunJob] REJECTED_IRRELEVANT_SOURCE (AI analysis): ${capture.sourceUrl}`);
            continue;
          }
        }

        const { data: sourceRecord } = await admin
          .from('web_search_sources')
          .select('id')
          .eq('job_id', jobId)
          .eq('source_url', capture.sourceUrl)
          .single();

        await admin.from('web_search_evidence').insert({
          job_id: jobId,
          source_id: sourceRecord?.id || null,
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
        console.log(`[RunJob] SOURCE_ACCEPTED_CAPTURED_EVIDENCE: ${capture.sourceUrl}`);
      } else {
        // Failed capture — check if it's high-value
        const matchingSource = capturableSources.find((s) => s.sourceUrl === capture.sourceUrl);
        const isHighValue = isHighValueFailedSource(
          {
            url: capture.sourceUrl,
            title: matchingSource?.reason.replace('Google SERP: ', '') || '',
            snippet: matchingSource?.snippet || '',
            sectionKey: capture.sectionKey,
            category: matchingSource?.category,
          },
          job.company_name,
          officialDomain
        );

        if (isHighValue) {
          failedHighValue++;
          console.log(`[RunJob] FAILED_SOURCE_SHOWN_HIGH_VALUE: ${capture.sourceUrl}`);

          const { data: sourceRecord } = await admin
            .from('web_search_sources')
            .select('id')
            .eq('job_id', jobId)
            .eq('source_url', capture.sourceUrl)
            .single();

          await admin.from('web_search_evidence').insert({
            job_id: jobId,
            source_id: sourceRecord?.id || null,
            section_key: capture.sectionKey,
            section_title: capture.sectionTitle,
            source_url: capture.sourceUrl,
            page_title: matchingSource?.reason.replace('Google SERP: ', '') || null,
            screenshot_url: null,
            extracted_text: null,
            ai_comment: null,
            evidence_bullets: null,
            confidence: null,
            flags: null,
            capture_status: 'failed',
            error_message: capture.errorMessage || 'Page was not captured',
            captured_at: capture.capturedAt,
          });
        } else {
          failedHidden++;
          console.log(`[RunJob] FAILED_SOURCE_HIDDEN: ${capture.sourceUrl}`);
        }
      }
    }

    // Analyze SERP-only sources (snippets from blocked but relevant domains)
    for (const serpSource of serpOnlySources) {
      if (!serpSource.snippet) continue;
      checkedSections.add(serpSource.sectionKey);

      const analysis = await analyzeSerpSnippet({
        sectionKey: serpSource.sectionKey,
        sectionTitle: serpSource.sectionTitle,
        sourceUrl: serpSource.sourceUrl,
        title: serpSource.reason.replace('Google SERP: ', ''),
        snippet: serpSource.snippet,
        companyName: job.company_name,
      });

      const { data: sourceRecord } = await admin
        .from('web_search_sources')
        .select('id')
        .eq('job_id', jobId)
        .eq('source_url', serpSource.sourceUrl)
        .single();

      await admin.from('web_search_evidence').insert({
        job_id: jobId,
        source_id: sourceRecord?.id || null,
        section_key: serpSource.sectionKey,
        section_title: serpSource.sectionTitle,
        source_url: serpSource.sourceUrl,
        page_title: serpSource.reason.replace('Google SERP: ', ''),
        screenshot_url: null,
        extracted_text: serpSource.snippet,
        ai_comment: analysis.aiComment,
        evidence_bullets: analysis.evidenceBullets,
        confidence: analysis.confidence,
        flags: analysis.flags,
        capture_status: 'search_only',
        error_message: null,
        captured_at: new Date().toISOString(),
      });

      console.log(`[RunJob] SOURCE_ACCEPTED_SEARCH_EVIDENCE: ${serpSource.sourceUrl}`);
    }

    // Step 4: Generate summary with coverage scoring
    const { data: allEvidence } = await admin
      .from('web_search_evidence')
      .select('section_key, capture_status, confidence, flags')
      .eq('job_id', jobId);

    const { summary, finalComment, coverage } = generateSummary(
      allEvidence || [],
      job.report_type,
      checkedSections
    );

    await admin
      .from('web_search_jobs')
      .update({
        status: 'completed',
        progress_step: null,
        summary_json: { ...summary, coverageScore: String(coverage.score), coverageStrength: coverage.strength },
        final_comment: finalComment,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await admin.from('report_activity').insert({
      job_id: jobId,
      user_id: user.id,
      activity_type: 'job_completed',
      message: `Report completed: ${capturedCount} captured (${internalPageResults.filter(r => r.status === 'success').length} internal), ${serpOnlySources.length} SERP, ${failedHighValue} high-value failed, ${failedHidden} hidden, ${rejectedCount} rejected. Score ${coverage.score}/100`,
    });

    return NextResponse.json({ success: true, jobId });
  } catch (err) {
    console.error('[API] /reports/run error:', err);

    const admin = createAdminClient();
    await admin
      .from('web_search_jobs')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        progress_step: null,
      })
      .eq('id', jobId);

    return NextResponse.json(
      { error: 'Report generation failed' },
      { status: 500 }
    );
  }
}
