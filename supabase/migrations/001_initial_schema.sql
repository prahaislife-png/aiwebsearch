-- AI Web Search - Database Schema
-- Run this migration in Supabase SQL Editor

-- 1. Profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text default 'user',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Web Search Jobs
create table if not exists public.web_search_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_name text not null,
  country text,
  official_website_input text,
  report_type text default 'basic',
  status text default 'queued',
  progress_step text,
  summary_json jsonb,
  final_comment text,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

-- 3. Web Search Sources
create table if not exists public.web_search_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.web_search_jobs(id) on delete cascade,
  section_key text not null,
  section_title text not null,
  source_url text not null,
  source_type text,
  discovery_method text,
  selected boolean default true,
  created_at timestamptz default now()
);

-- 4. Web Search Evidence
create table if not exists public.web_search_evidence (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.web_search_jobs(id) on delete cascade,
  source_id uuid references public.web_search_sources(id) on delete set null,
  section_key text not null,
  section_title text not null,
  source_url text not null,
  page_title text,
  screenshot_url text,
  screenshot_storage_path text,
  extracted_text text,
  ai_comment text,
  evidence_bullets jsonb,
  confidence text,
  flags jsonb,
  capture_status text default 'pending',
  error_message text,
  captured_at timestamptz,
  created_at timestamptz default now()
);

-- 5. Report Activity
create table if not exists public.report_activity (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.web_search_jobs(id) on delete cascade,
  user_id uuid references auth.users(id),
  activity_type text,
  message text,
  metadata jsonb,
  created_at timestamptz default now()
);

-- 6. Indexes
create index if not exists idx_jobs_user_id on public.web_search_jobs(user_id);
create index if not exists idx_jobs_status on public.web_search_jobs(status);
create index if not exists idx_sources_job_id on public.web_search_sources(job_id);
create index if not exists idx_evidence_job_id on public.web_search_evidence(job_id);
create index if not exists idx_activity_job_id on public.report_activity(job_id);

-- 7. RLS Policies
alter table public.profiles enable row level security;
alter table public.web_search_jobs enable row level security;
alter table public.web_search_sources enable row level security;
alter table public.web_search_evidence enable row level security;
alter table public.report_activity enable row level security;

-- Profiles: users can read/update own profile, admins can read all
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Jobs: users see own, admins see all
create policy "Users can view own jobs"
  on public.web_search_jobs for select
  using (auth.uid() = user_id);

create policy "Users can insert own jobs"
  on public.web_search_jobs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own jobs"
  on public.web_search_jobs for update
  using (auth.uid() = user_id);

create policy "Admins can view all jobs"
  on public.web_search_jobs for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Sources: access through job ownership
create policy "Users can view own sources"
  on public.web_search_sources for select
  using (
    exists (select 1 from public.web_search_jobs where id = job_id and user_id = auth.uid())
  );

create policy "Users can insert own sources"
  on public.web_search_sources for insert
  with check (
    exists (select 1 from public.web_search_jobs where id = job_id and user_id = auth.uid())
  );

-- Evidence: access through job ownership
create policy "Users can view own evidence"
  on public.web_search_evidence for select
  using (
    exists (select 1 from public.web_search_jobs where id = job_id and user_id = auth.uid())
  );

create policy "Users can insert own evidence"
  on public.web_search_evidence for insert
  with check (
    exists (select 1 from public.web_search_jobs where id = job_id and user_id = auth.uid())
  );

-- Activity: access through job ownership
create policy "Users can view own activity"
  on public.report_activity for select
  using (
    exists (select 1 from public.web_search_jobs where id = job_id and user_id = auth.uid())
  );

create policy "Users can insert own activity"
  on public.report_activity for insert
  with check (auth.uid() = user_id);

-- 8. Auth trigger to create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 9. Storage bucket
insert into storage.buckets (id, name, public)
values ('web-search-screenshots', 'web-search-screenshots', true)
on conflict (id) do nothing;

-- Storage policy: authenticated users can upload
create policy "Authenticated users can upload screenshots"
  on storage.objects for insert
  with check (bucket_id = 'web-search-screenshots' and auth.role() = 'authenticated');

-- Storage policy: public read
create policy "Public can view screenshots"
  on storage.objects for select
  using (bucket_id = 'web-search-screenshots');
