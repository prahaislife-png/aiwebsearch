'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AccountPage() {
  const [profile, setProfile] = useState<{ email?: string; full_name?: string; role?: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const loadUser = async () => {
      const res = await fetch('/api/account');
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    };
    loadUser();
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-accent">AI Web Search</h1>
          <p className="mt-2 text-sm text-muted">Account Settings</p>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Email</label>
            <p className="text-foreground">{profile?.email || '—'}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-1">Name</label>
            <p className="text-foreground">{profile?.full_name || '—'}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-1">Role</label>
            <p className="text-foreground capitalize">{profile?.role || 'user'}</p>
          </div>

          <div className="pt-4 space-y-3">
            <Link
              href="/"
              className="block w-full text-center rounded-lg border border-card-border py-2.5 text-sm font-medium text-foreground hover:bg-card-border/50"
            >
              Back to Dashboard
            </Link>
            <button
              onClick={handleLogout}
              className="w-full rounded-lg bg-error/10 border border-error/20 py-2.5 text-sm font-medium text-error hover:bg-error/20"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
