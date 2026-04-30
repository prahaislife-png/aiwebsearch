'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Stats {
  totalUsers: number;
  totalReports: number;
  reportsToday: number;
  reportsThisMonth: number;
  failedCaptures: number;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  report_count: number;
}

interface ReportRow {
  id: string;
  company_name: string;
  status: string;
  created_at: string;
  user_id: string;
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAdmin = async () => {
      try {
        const [statsRes, usersRes] = await Promise.all([
          fetch('/api/admin/stats'),
          fetch('/api/admin/users'),
        ]);

        if (statsRes.ok) {
          setStats(await statsRes.json());
        }
        if (usersRes.ok) {
          const data = await usersRes.json();
          setUsers(data.users || []);
          setReports(data.latestReports || []);
        }
      } catch (err) {
        console.error('Failed to load admin data:', err);
      }
      setLoading(false);
    };
    loadAdmin();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted">Loading admin data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-accent">Admin Dashboard</h1>
            <p className="text-sm text-muted mt-1">AI Web Search Administration</p>
          </div>
          <Link
            href="/"
            className="text-sm text-muted hover:text-accent"
          >
            &larr; Back to App
          </Link>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <div className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-2xl font-bold text-foreground">{stats.totalUsers}</p>
              <p className="text-xs text-muted">Total Users</p>
            </div>
            <div className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-2xl font-bold text-foreground">{stats.totalReports}</p>
              <p className="text-xs text-muted">Total Reports</p>
            </div>
            <div className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-2xl font-bold text-accent">{stats.reportsToday}</p>
              <p className="text-xs text-muted">Reports Today</p>
            </div>
            <div className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-2xl font-bold text-foreground">{stats.reportsThisMonth}</p>
              <p className="text-xs text-muted">This Month</p>
            </div>
            <div className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-2xl font-bold text-error">{stats.failedCaptures}</p>
              <p className="text-xs text-muted">Failed Captures</p>
            </div>
          </div>
        )}

        {/* Users Table */}
        <div className="rounded-xl border border-card-border bg-card p-6 mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Users</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-left">
                  <th className="pb-3 text-muted font-medium">Email</th>
                  <th className="pb-3 text-muted font-medium">Role</th>
                  <th className="pb-3 text-muted font-medium">Reports</th>
                  <th className="pb-3 text-muted font-medium">Active</th>
                  <th className="pb-3 text-muted font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-card-border/50">
                    <td className="py-3 text-foreground">{user.email}</td>
                    <td className="py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        user.role === 'admin' ? 'bg-accent/20 text-accent' : 'bg-muted/20 text-muted'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="py-3 text-foreground">{user.report_count}</td>
                    <td className="py-3">
                      <span className={`w-2 h-2 rounded-full inline-block ${
                        user.is_active ? 'bg-success' : 'bg-error'
                      }`} />
                    </td>
                    <td className="py-3 text-muted">{new Date(user.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Latest Reports */}
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Latest Reports</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-left">
                  <th className="pb-3 text-muted font-medium">Company</th>
                  <th className="pb-3 text-muted font-medium">Status</th>
                  <th className="pb-3 text-muted font-medium">Created</th>
                  <th className="pb-3 text-muted font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id} className="border-b border-card-border/50">
                    <td className="py-3 text-foreground">{report.company_name}</td>
                    <td className="py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        report.status === 'completed' ? 'bg-success/20 text-success' :
                        report.status === 'failed' ? 'bg-error/20 text-error' :
                        'bg-accent/20 text-accent'
                      }`}>
                        {report.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 text-muted">{new Date(report.created_at).toLocaleDateString()}</td>
                    <td className="py-3">
                      <Link href={`/reports/${report.id}`} className="text-accent hover:underline text-xs">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
