import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ApifyCaptureProvider } from '@/lib/browser-capture/apify-provider';
import { MockCaptureProvider } from '@/lib/browser-capture/mock-provider';
import { analyzeEvidence } from '@/lib/ai/analyze-evidence';
import { CaptureProvider } from '@/lib/browser-capture/capture-provider';
import { NextResponse } from 'next/server';

function getCaptureProvider(): CaptureProvider {
  if (process.env.APIFY_TOKEN && process.env.APIFY_WEB_SEARCH_ACTOR_ID) {
    return new ApifyCaptureProvider();
  }
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

    const body = await request.json();
    const { sectionKey, url } = body;

    if (!url || !sectionKey) {
      return NextResponse.json(
        { error: 'URL and section are required' },
        { status: 400 }
      );
    }

    // Verify job ownership
    const { data: job } = await supabase
      .from('web_search_jobs')
      .select('id, company_name, country')
      .eq('id', jobId)
      .single();

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const sectionTitles: Record<string, string> = {
      official_website: 'Official Website / Homepage',
      about_company: 'About / Activity / Products / Services',
      contact_location: 'Contact / Location / Operational Address',
      public_registry: 'Corporate Registry / Public Record',
      management_history: 'History / Founder / Management / Ownership',
      group_shareholding: 'Corporate Group / Parent / Shareholding / Government Connection',
      other: 'Other / Additional Source',
    };

    const sectionTitle = sectionTitles[sectionKey] || 'Other';
    const admin = createAdminClient();

    // Create source record
    const { data: source } = await admin
      .from('web_search_sources')
      .insert({
        job_id: jobId,
        section_key: sectionKey,
        section_title: sectionTitle,
        source_url: url,
        source_type: 'manual',
        discovery_method: 'Manually added by user',
        selected: true,
      })
      .select('id')
      .single();

    // Capture the page
    const captureProvider = getCaptureProvider();
    const results = await captureProvider.capturePages({
      jobId,
      companyName: job.company_name,
      country: job.country,
      urls: [{ sectionKey, sectionTitle, url }],
    });

    const capture = results[0];

    // Analyze
    let analysis = null;
    if (capture && capture.status === 'success') {
      analysis = await analyzeEvidence({
        sectionKey,
        sectionTitle,
        sourceUrl: url,
        pageTitle: capture.pageTitle,
        extractedText: capture.extractedText,
        companyName: job.company_name,
      });
    }

    // Store evidence
    await admin.from('web_search_evidence').insert({
      job_id: jobId,
      source_id: source?.id || null,
      section_key: sectionKey,
      section_title: sectionTitle,
      source_url: url,
      page_title: capture?.pageTitle || null,
      screenshot_url: capture?.screenshotUrl || null,
      extracted_text: capture?.extractedText || null,
      ai_comment: analysis?.aiComment || null,
      evidence_bullets: analysis?.evidenceBullets || null,
      confidence: analysis?.confidence || null,
      flags: analysis?.flags || null,
      capture_status: capture?.status === 'success' ? 'captured' : 'failed',
      error_message: capture?.errorMessage || null,
      captured_at: capture?.capturedAt || new Date().toISOString(),
    });

    // Log activity
    await admin.from('report_activity').insert({
      job_id: jobId,
      user_id: user.id,
      activity_type: 'source_added',
      message: `Manual source added: ${url}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API] /reports/[jobId]/add-source error:', err);
    return NextResponse.json(
      { error: 'Failed to add source' },
      { status: 500 }
    );
  }
}
