-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Crea el bucket público de PDFs y el índice consultado por archivo.html.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('planillas', 'planillas', true, 52428800, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.pdf_documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  storage_path text not null unique,
  public_url text not null,
  os text,
  lugar text,
  sala text,
  area text,
  armado text,
  desarme text,
  lider text,
  total_units integer not null default 0 check (total_units >= 0),
  file_size bigint not null default 0 check (file_size >= 0),
  created_at timestamptz not null default now()
);

create index if not exists pdf_documents_created_at_idx on public.pdf_documents (created_at desc);
create index if not exists pdf_documents_os_idx on public.pdf_documents (os);
create index if not exists pdf_documents_area_idx on public.pdf_documents (area);

alter table public.pdf_documents enable row level security;
grant select, insert on table public.pdf_documents to anon;

drop policy if exists "Public PDF index can be read" on public.pdf_documents;
create policy "Public PDF index can be read"
on public.pdf_documents for select to anon
using (true);

drop policy if exists "Planillero can register PDFs" on public.pdf_documents;
create policy "Planillero can register PDFs"
on public.pdf_documents for insert to anon
with check (
  storage_path like '____/__/%.pdf'
  and file_size >= 0
  and total_units >= 0
);

drop policy if exists "Public planillas PDFs can be read" on storage.objects;
create policy "Public planillas PDFs can be read"
on storage.objects for select to anon
using (bucket_id = 'planillas');

drop policy if exists "Planillero can upload PDFs" on storage.objects;
create policy "Planillero can upload PDFs"
on storage.objects for insert to anon
with check (
  bucket_id = 'planillas'
  and lower(storage.extension(name)) = 'pdf'
);
