import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export async function GET(
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
      .single();

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Non-admin users can only see their own jobs
    if (job.user_id !== user.id) {
      const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profile?.role !== 'admin') {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }
    }

    const { data: sources } = await admin
      .from('web_search_sources')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at');

    const { data: evidence } = await admin
      .from('web_search_evidence')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at');

    const { data: activity } = await admin
      .from('report_activity')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(20);

    return NextResponse.json({
      job,
      sources: sources || [],
      evidence: evidence || [],
      activity: activity || [],
    });
  } catch (err) {
    console.error('[API] /reports/[jobId] GET error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
