import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ reports: [] });
    }

    const admin = createAdminClient();
    const { data } = await admin
      .from('web_search_jobs')
      .select('id, company_name, country, report_type, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    return NextResponse.json({ reports: data || [] });
  } catch {
    return NextResponse.json({ reports: [] });
  }
}
