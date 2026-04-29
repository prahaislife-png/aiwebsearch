'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ReportJob {
  id: string;
  company_name: string;
  country: string | null;
  report_type: string;
  status: string;
  created_at: string;
}

export default function DashboardPage() {
  const [companyName, setCompanyName] = useState('');
  const [country, setCountry] = useState('');
  const [officialWebsite, setOfficialWebsite] = useState('');
  const [reportType, setReportType] = useState('basic');
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
          reportType,
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
      queued: 'bg-muted/20 text-muted',
      discovering_sources: 'bg-accent/20 text-accent',
      capturing_screenshots: 'bg-accent/20 text-accent',
      analyzing: 'bg-accent/20 text-accent',
      completed: 'bg-success/20 text-success',
      failed: 'bg-error/20 text-error',
    };
    return colors[status] || 'bg-muted/20 text-muted';
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-accent">AI Web Search</h1>
            <p className="text-sm text-muted mt-1">
              Automated company web search reports with screenshots, sources, and AI comments.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <Link
                href="/account"
                className="text-sm text-muted hover:text-foreground"
              >
                {user.email}
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>

        {/* Main Form Card */}
        <div className="rounded-xl border border-card-border bg-card p-6 mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Create Web Search Report
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-error/10 border border-error/20 p-3 text-sm text-error">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  Company Name <span className="text-error">*</span>
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
                <label className="block text-sm font-medium text-muted mb-1">
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
              <label className="block text-sm font-medium text-muted mb-1">
                Official Website
              </label>
              <input
                type="url"
                value={officialWebsite}
                onChange={(e) => setOfficialWebsite(e.target.value)}
                placeholder="https://www.example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">
                Report Type
              </label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
              >
                <option value="basic">Basic</option>
                <option value="enhanced">Enhanced</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={loading || !user}
              className="w-full rounded-lg bg-accent py-3 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? 'Creating Report...' : 'Run Web Search'}
            </button>

            {!user && (
              <p className="text-center text-sm text-muted">
                <Link href="/login" className="text-accent hover:underline">
                  Sign in
                </Link>{' '}
                to create reports.
              </p>
            )}
          </form>
        </div>

        {/* Recent Reports */}
        {user && recentReports.length > 0 && (
          <div className="rounded-xl border border-card-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Recent Reports
            </h2>
            <div className="space-y-3">
              {recentReports.map((report) => (
                <Link
                  key={report.id}
                  href={`/reports/${report.id}`}
                  className="flex items-center justify-between rounded-lg border border-card-border p-4 hover:border-accent/30 transition-colors"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {report.company_name}
                    </p>
                    <p className="text-xs text-muted">
                      {report.country && `${report.country} • `}
                      {new Date(report.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase text-muted">
                      {report.report_type}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusBadge(report.status)}`}
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
