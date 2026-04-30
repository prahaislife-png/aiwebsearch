import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { companyName, country, officialWebsite } = body;

    if (!companyName || typeof companyName !== 'string') {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const { data: job, error } = await admin
      .from('web_search_jobs')
      .insert({
        user_id: user.id,
        company_name: companyName,
        country: country || null,
        official_website_input: officialWebsite || null,
        report_type: 'enhanced',
        status: 'queued',
      })
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log activity
    await admin.from('report_activity').insert({
      job_id: job.id,
      user_id: user.id,
      activity_type: 'job_created',
      message: `Web search report created for "${companyName}"`,
    });

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    console.error('[API] /reports/create error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
