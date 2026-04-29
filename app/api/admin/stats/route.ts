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

    const { count: totalUsers } = await admin
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    const { count: totalReports } = await admin
      .from('web_search_jobs')
      .select('*', { count: 'exact', head: true });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: reportsToday } = await admin
      .from('web_search_jobs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const { count: reportsThisMonth } = await admin
      .from('web_search_jobs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthStart.toISOString());

    const { count: failedCaptures } = await admin
      .from('web_search_evidence')
      .select('*', { count: 'exact', head: true })
      .eq('capture_status', 'failed');

    return NextResponse.json({
      totalUsers: totalUsers || 0,
      totalReports: totalReports || 0,
      reportsToday: reportsToday || 0,
      reportsThisMonth: reportsThisMonth || 0,
      failedCaptures: failedCaptures || 0,
    });
  } catch (err) {
    console.error('[API] /admin/stats error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
