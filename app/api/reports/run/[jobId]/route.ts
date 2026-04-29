import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { discoverCompanySources } from '@/lib/source-discovery';
import { ApifyCaptureProvider } from '@/lib/browser-capture/apify-provider';
import { MockCaptureProvider } from '@/lib/browser-capture/mock-provider';
import { analyzeEvidence, analyzeSerpSnippet } from '@/lib/ai/analyze-evidence';
import { generateSummary } from '@/lib/report-summary';
import { CaptureProvider } from '@/lib/browser-capture/capture-provider';
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

    // Step 1: Discover sources via Google SERP
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

    console.log(`[RunJob] Discovered ${sources.length} sources (${sources.filter(s => s.shouldCapture).length} capturable)`);

    // Store all discovered sources
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

    // Step 2: Capture pages (only capturable URLs)
    const capturableSources = sources.filter((s) => s.shouldCapture);
    const serpOnlySources = sources.filter((s) => !s.shouldCapture);

    await admin
      .from('web_search_jobs')
      .update({ status: 'capturing_screenshots', progress_step: `Capturing ${capturableSources.length} pages...` })
      .eq('id', jobId);

    const captureProvider = getCaptureProvider();
    const captureResults = await captureProvider.capturePages({
      jobId,
      companyName: job.company_name,
      country: job.country,
      urls: capturableSources.map((s) => ({
        sectionKey: s.sectionKey,
        sectionTitle: s.sectionTitle,
        url: s.sourceUrl,
      })),
    });

    // Step 3: Analyze captured evidence
    await admin
      .from('web_search_jobs')
      .update({ status: 'analyzing', progress_step: 'Analyzing captured evidence...' })
      .eq('id', jobId);

    // Analyze captured pages
    for (const capture of captureResults) {
      let analysis = null;
      if (capture.status === 'success') {
        analysis = await analyzeEvidence({
          sectionKey: capture.sectionKey,
          sectionTitle: capture.sectionTitle,
          sourceUrl: capture.sourceUrl,
          pageTitle: capture.pageTitle,
          extractedText: capture.extractedText,
          companyName: job.company_name,
        });
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
        ai_comment: analysis?.aiComment || null,
        evidence_bullets: analysis?.evidenceBullets || null,
        confidence: analysis?.confidence || null,
        flags: analysis?.flags || null,
        capture_status: capture.status === 'success' ? 'captured' : 'failed',
        error_message: capture.errorMessage || null,
        captured_at: capture.capturedAt,
      });
    }

    // Analyze SERP-only sources (snippets from blocked domains)
    for (const serpSource of serpOnlySources) {
      if (!serpSource.snippet) continue;

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
    }

    // Step 4: Generate summary with coverage scoring
    const { data: allEvidence } = await admin
      .from('web_search_evidence')
      .select('section_key, capture_status, confidence, flags')
      .eq('job_id', jobId);

    const { summary, finalComment, coverage } = generateSummary(
      allEvidence || [],
      job.report_type
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
      message: `Report completed: ${captureResults.filter(r => r.status === 'success').length} pages captured, ${serpOnlySources.length} SERP-only sources, score ${coverage.score}/100`,
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
