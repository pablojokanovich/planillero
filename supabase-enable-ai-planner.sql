-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Habilita carga temporal de órdenes y persistencia de borradores IA.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-orders', 'service-orders', true, 52428800, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.ai_plan_jobs (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null,
  source_path text not null,
  source_url text not null,
  status text not null default 'questions' check (status in ('questions', 'draft', 'approved', 'error')),
  analysis jsonb not null default '{}'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  draft jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_plan_audit (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.ai_plan_jobs(id) on delete cascade,
  action text not null check (action in ('created', 'analyzed', 'generated', 'edited', 'approved', 'returned_to_draft')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_plan_rules (
  id uuid primary key default gen_random_uuid(),
  rule_text text not null check (length(trim(rule_text)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ai_plan_jobs_created_idx on public.ai_plan_jobs (created_at desc);
create index if not exists ai_plan_audit_job_idx on public.ai_plan_audit (job_id, created_at desc);

alter table public.ai_plan_jobs enable row level security;
alter table public.ai_plan_audit enable row level security;
alter table public.ai_plan_rules enable row level security;

grant select, insert, update on table public.ai_plan_jobs to anon;
grant select, insert on table public.ai_plan_audit to anon;
grant select, insert, update on table public.ai_plan_rules to anon;
grant usage, select on sequence public.ai_plan_audit_id_seq to anon;

drop policy if exists "AI jobs can be read" on public.ai_plan_jobs;
create policy "AI jobs can be read" on public.ai_plan_jobs for select to anon using (true);
drop policy if exists "AI jobs can be created" on public.ai_plan_jobs;
create policy "AI jobs can be created" on public.ai_plan_jobs for insert to anon with check (true);
drop policy if exists "AI jobs can be updated" on public.ai_plan_jobs;
create policy "AI jobs can be updated" on public.ai_plan_jobs for update to anon using (true) with check (true);

drop policy if exists "AI audit can be read" on public.ai_plan_audit;
create policy "AI audit can be read" on public.ai_plan_audit for select to anon using (true);
drop policy if exists "AI audit can be created" on public.ai_plan_audit;
create policy "AI audit can be created" on public.ai_plan_audit for insert to anon with check (true);

drop policy if exists "AI rules can be read" on public.ai_plan_rules;
create policy "AI rules can be read" on public.ai_plan_rules for select to anon using (true);
drop policy if exists "AI rules can be created" on public.ai_plan_rules;
create policy "AI rules can be created" on public.ai_plan_rules for insert to anon with check (true);
drop policy if exists "AI rules can be updated" on public.ai_plan_rules;
create policy "AI rules can be updated" on public.ai_plan_rules for update to anon using (true) with check (true);

drop policy if exists "Service orders can be read" on storage.objects;
create policy "Service orders can be read" on storage.objects for select to anon
using (bucket_id = 'service-orders');

drop policy if exists "Service orders can be uploaded" on storage.objects;
create policy "Service orders can be uploaded" on storage.objects for insert to anon
with check (
  bucket_id = 'service-orders'
  and lower(storage.extension(name)) = 'pdf'
);
