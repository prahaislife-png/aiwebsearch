import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminClient();

    const { data: users } = await admin
      .from('profiles')
      .select('id, email, role, is_active, created_at')
      .order('created_at', { ascending: false });

    // Get report counts per user
    const { data: reportCounts } = await admin
      .from('web_search_jobs')
      .select('user_id');

    const countMap: Record<string, number> = {};
    if (reportCounts) {
      for (const r of reportCounts) {
        countMap[r.user_id] = (countMap[r.user_id] || 0) + 1;
      }
    }

    const usersWithCounts = (users || []).map((u) => ({
      ...u,
      report_count: countMap[u.id] || 0,
    }));

    // Get latest reports
    const { data: latestReports } = await admin
      .from('web_search_jobs')
      .select('id, company_name, status, report_type, created_at, user_id')
      .order('created_at', { ascending: false })
      .limit(20);

    return NextResponse.json({
      users: usersWithCounts,
      latestReports: latestReports || [],
    });
  } catch (err) {
    console.error('[API] /admin/users error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
