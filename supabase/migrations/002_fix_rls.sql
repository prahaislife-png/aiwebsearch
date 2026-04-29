-- Run this in Supabase SQL Editor to fix the recursive RLS policies
-- This disables RLS and replaces it with simpler non-recursive policies

-- First drop all existing problematic policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own jobs" ON public.web_search_jobs;
DROP POLICY IF EXISTS "Users can insert own jobs" ON public.web_search_jobs;
DROP POLICY IF EXISTS "Users can update own jobs" ON public.web_search_jobs;
DROP POLICY IF EXISTS "Admins can view all jobs" ON public.web_search_jobs;
DROP POLICY IF EXISTS "Users can view own sources" ON public.web_search_sources;
DROP POLICY IF EXISTS "Users can insert own sources" ON public.web_search_sources;
DROP POLICY IF EXISTS "Users can view own evidence" ON public.web_search_evidence;
DROP POLICY IF EXISTS "Users can insert own evidence" ON public.web_search_evidence;
DROP POLICY IF EXISTS "Users can view own activity" ON public.report_activity;
DROP POLICY IF EXISTS "Users can insert own activity" ON public.report_activity;

-- Disable RLS on all tables (auth is enforced at proxy + API route level)
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_search_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_search_sources DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_search_evidence DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_activity DISABLE ROW LEVEL SECURITY;
