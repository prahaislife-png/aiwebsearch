'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ReportJob {
  id: string;
  company_name: string;
  country: string | null;
  status: string;
  created_at: string;
}

export default function DashboardPage() {
  const [companyName, setCompanyName] = useState('');
  const [country, setCountry] = useState('');
  const [officialWebsite, setOfficialWebsite] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [recentReports, setRecentReports] = useState<ReportJob[]>([]);
  const router = useRouter();

  useEffect(() => {
    const loadData = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        const res = await fetch('/api/reports/list');
        if (res.ok) {
          const data = await res.json();
          setRecentReports(data.reports || []);
        }
      }
    };
    loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/reports/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          country: country.trim() || null,
          officialWebsite: officialWebsite.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create report');

      router.push(`/reports/${data.jobId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      queued: 'bg-[#EDEAE3] text-[#6E736C]',
      discovering_sources: 'bg-[#E7EEE3] text-[#5E7358]',
      capturing_screenshots: 'bg-[#E7EEE3] text-[#5E7358]',
      analyzing: 'bg-[#E7EEE3] text-[#5E7358]',
      completed: 'bg-[#E7EEE3] text-[#5E7358]',
      failed: 'bg-[#F5E6E4] text-[#B5443C]',
    };
    return colors[status] || 'bg-[#EDEAE3] text-[#6E736C]';
  };

  return (
    <div className="min-h-screen p-5 md:p-10">
      <div className="mx-auto" style={{ maxWidth: '1000px' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="font-bold tracking-tight text-[#2F332F]" style={{ fontSize: '34px' }}>
              AI Web Search
            </h1>
            <p className="text-[#6E736C] mt-1.5" style={{ fontSize: '15px' }}>
              Automated company verification with screenshots, sources, and AI analysis.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <Link
                href="/account"
                className="text-[#6B726A] hover:text-[#2F332F] transition-colors"
                style={{ fontSize: '14px' }}
              >
                {user.email}
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-xl bg-[#586F52] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#465A42] transition-colors"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>

        {/* Main Form Card */}
        <div
          className="rounded-2xl bg-white mb-8"
          style={{
            border: '1px solid #E3DED3',
            boxShadow: '0 10px 30px rgba(40, 40, 30, 0.06)',
            padding: '28px',
          }}
        >
          <h2 className="font-bold text-[#2F332F] mb-5" style={{ fontSize: '19px' }}>
            Create Web Search Report
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-xl bg-[#F5E6E4] border border-[#E8C9C5] p-3.5 text-sm text-[#B5443C]">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block font-medium text-[#5C625A] mb-1.5" style={{ fontSize: '14px' }}>
                  Company Name <span className="text-[#B5443C]">*</span>
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  placeholder="e.g. Acme Corporation"
                />
              </div>

              <div>
                <label className="block font-medium text-[#5C625A] mb-1.5" style={{ fontSize: '14px' }}>
                  Country
                </label>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. Germany"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-[#5C625A] mb-1.5" style={{ fontSize: '14px' }}>
                Official Website
              </label>
              <input
                type="url"
                value={officialWebsite}
                onChange={(e) => setOfficialWebsite(e.target.value)}
                placeholder="https://www.example.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !user}
              className="w-full rounded-xl text-white font-semibold disabled:opacity-50 transition-colors"
              style={{
                backgroundColor: loading ? '#6E8268' : '#586F52',
                height: '48px',
                fontSize: '15px',
              }}
              onMouseEnter={(e) => { if (!loading) (e.target as HTMLElement).style.backgroundColor = '#465A42'; }}
              onMouseLeave={(e) => { if (!loading) (e.target as HTMLElement).style.backgroundColor = '#586F52'; }}
            >
              {loading ? 'Creating Report...' : 'Run Web Search'}
            </button>

            {!user && (
              <p className="text-center text-sm text-[#6E736C]">
                <Link href="/login" className="text-[#586F52] font-medium hover:underline">
                  Sign in
                </Link>{' '}
                to create reports.
              </p>
            )}
          </form>
        </div>

        {/* Recent Reports */}
        {user && recentReports.length > 0 && (
          <div
            className="rounded-2xl bg-white"
            style={{
              border: '1px solid #E3DED3',
              boxShadow: '0 10px 30px rgba(40, 40, 30, 0.06)',
              padding: '28px',
            }}
          >
            <h2 className="font-bold text-[#2F332F] mb-5" style={{ fontSize: '19px' }}>
              Recent Reports
            </h2>
            <div className="space-y-3">
              {recentReports.map((report) => (
                <Link
                  key={report.id}
                  href={`/reports/${report.id}`}
                  className="flex items-center justify-between rounded-xl border border-[#E6E1D7] p-4 hover:border-[#C5CEBC] transition-colors"
                  style={{ padding: '16px 18px' }}
                >
                  <div>
                    <p className="font-semibold text-[#2F332F]" style={{ fontSize: '15px' }}>
                      {report.company_name}
                    </p>
                    <p className="text-[#6E736C] mt-0.5" style={{ fontSize: '13px' }}>
                      {report.country && `${report.country} · `}
                      {new Date(report.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full font-semibold ${getStatusBadge(report.status)}`}
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      {report.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
