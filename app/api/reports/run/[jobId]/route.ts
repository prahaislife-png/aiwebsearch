import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { discoverCompanySources } from '@/lib/source-discovery';
import { ApifyCaptureProvider } from '@/lib/browser-capture/apify-provider';
import { MockCaptureProvider } from '@/lib/browser-capture/mock-provider';
import { analyzeEvidence } from '@/lib/ai/analyze-evidence';
import { generateSummary } from '@/lib/report-summary';
import { CaptureProvider } from '@/lib/browser-capture/capture-provider';
import { NextResponse } from 'next/server';

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

    // Get job
    const { data: job } = await admin
      .from('web_search_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single();

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Step 1: Discover sources
    await admin
      .from('web_search_jobs')
      .update({ status: 'discovering_sources', progress_step: 'Discovering public sources...' })
      .eq('id', jobId);

    const sources = await discoverCompanySources({
      companyName: job.company_name,
      country: job.country,
      officialWebsite: job.official_website_input,
      reportType: job.report_type,
    });

    // Store discovered sources
    for (const source of sources) {
      await admin.from('web_search_sources').insert({
        job_id: jobId,
        section_key: source.sectionKey,
        section_title: source.sectionTitle,
        source_url: source.sourceUrl,
        source_type: source.sourceType,
        discovery_method: source.reason,
        selected: true,
      });
    }

    // Step 2: Capture screenshots
    await admin
      .from('web_search_jobs')
      .update({ status: 'capturing_screenshots', progress_step: 'Capturing screenshots...' })
      .eq('id', jobId);

    const captureProvider = getCaptureProvider();
    const captureResults = await captureProvider.capturePages({
      jobId,
      companyName: job.company_name,
      country: job.country,
      urls: sources.map((s) => ({
        sectionKey: s.sectionKey,
        sectionTitle: s.sectionTitle,
        url: s.sourceUrl,
      })),
    });

    // Step 3: Analyze evidence
    await admin
      .from('web_search_jobs')
      .update({ status: 'analyzing', progress_step: 'Analyzing captured evidence...' })
      .eq('id', jobId);

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

      // Find the source record
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

    // Step 4: Generate summary
    const { data: allEvidence } = await admin
      .from('web_search_evidence')
      .select('section_key, capture_status, confidence, flags')
      .eq('job_id', jobId);

    const { summary, finalComment } = generateSummary(
      allEvidence || [],
      job.report_type
    );

    // Update job as completed
    await admin
      .from('web_search_jobs')
      .update({
        status: 'completed',
        progress_step: null,
        summary_json: summary,
        final_comment: finalComment,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    // Log activity
    await admin.from('report_activity').insert({
      job_id: jobId,
      user_id: user.id,
      activity_type: 'job_completed',
      message: `Report completed with ${captureResults.length} sources captured`,
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
