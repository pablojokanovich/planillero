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
  event_data jsonb,
  total_units integer not null default 0 check (total_units >= 0),
  file_size bigint not null default 0 check (file_size >= 0),
  created_at timestamptz not null default now()
);

-- Mantiene compatibles los proyectos creados con una versión anterior.
alter table public.pdf_documents add column if not exists event_data jsonb;

create index if not exists pdf_documents_created_at_idx on public.pdf_documents (created_at desc);
create index if not exists pdf_documents_os_idx on public.pdf_documents (os);
create index if not exists pdf_documents_area_idx on public.pdf_documents (area);

alter table public.pdf_documents enable row level security;
grant select, insert, delete on table public.pdf_documents to anon;

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

drop policy if exists "PDF records can be deleted" on public.pdf_documents;
create policy "PDF records can be deleted"
on public.pdf_documents for delete to anon
using (true);

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

drop policy if exists "Planillero PDFs can be deleted" on storage.objects;
create policy "Planillero PDFs can be deleted"
on storage.objects for delete to anon
using (
  bucket_id = 'planillas'
  and lower(storage.extension(name)) = 'pdf'
);

-- Inventario compartido por todos los navegadores.
create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  area text not null check (area in ('cctv', 'sonido', 'video', 'luces')),
  name text not null check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (area, name)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.inventory_categories(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (category_id, name)
);

alter table public.inventory_categories drop constraint if exists inventory_categories_area_check;
alter table public.inventory_categories add constraint inventory_categories_area_check
check (area in ('cctv', 'sonido', 'video', 'luces'));

create index if not exists inventory_categories_order_idx on public.inventory_categories (area, sort_order);
create index if not exists inventory_items_category_order_idx on public.inventory_items (category_id, sort_order);

alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
grant select, insert, delete on table public.inventory_categories to anon;
grant select, insert, delete on table public.inventory_items to anon;

drop policy if exists "Shared inventory categories can be read" on public.inventory_categories;
create policy "Shared inventory categories can be read" on public.inventory_categories for select to anon using (true);
drop policy if exists "Shared inventory categories can be created" on public.inventory_categories;
create policy "Shared inventory categories can be created" on public.inventory_categories for insert to anon with check (true);
drop policy if exists "Shared inventory categories can be deleted" on public.inventory_categories;
create policy "Shared inventory categories can be deleted" on public.inventory_categories for delete to anon using (true);

drop policy if exists "Shared inventory items can be read" on public.inventory_items;
create policy "Shared inventory items can be read" on public.inventory_items for select to anon using (true);
drop policy if exists "Shared inventory items can be created" on public.inventory_items;
create policy "Shared inventory items can be created" on public.inventory_items for insert to anon with check (true);
drop policy if exists "Shared inventory items can be deleted" on public.inventory_items;
create policy "Shared inventory items can be deleted" on public.inventory_items for delete to anon using (true);

-- Freelancers compartidos por todos los navegadores.
create table if not exists public.freelancers (
  id bigint primary key,
  nombre text not null check (length(trim(nombre)) > 0),
  area text not null check (area in ('CCTV', 'Sonido', 'Iluminacion', 'Video', 'Traduccion', 'Computers', 'Otros')),
  telefono text not null default '',
  alimentacion text not null default 'comun' check (alimentacion in ('comun', 'vegetariano', 'sin_tacc')),
  created_at timestamptz not null default now()
);

alter table public.freelancers add column if not exists alimentacion text not null default 'comun';
alter table public.freelancers drop constraint if exists freelancers_alimentacion_check;
alter table public.freelancers add constraint freelancers_alimentacion_check
check (alimentacion in ('comun', 'vegetariano', 'sin_tacc'));

create index if not exists freelancers_area_nombre_idx on public.freelancers (area, nombre);

alter table public.freelancers enable row level security;
grant select, insert, update, delete on table public.freelancers to anon;

drop policy if exists "Shared freelancers can be read" on public.freelancers;
create policy "Shared freelancers can be read" on public.freelancers for select to anon using (true);
drop policy if exists "Shared freelancers can be created" on public.freelancers;
create policy "Shared freelancers can be created" on public.freelancers for insert to anon with check (true);
drop policy if exists "Shared freelancers can be updated" on public.freelancers;
create policy "Shared freelancers can be updated" on public.freelancers for update to anon using (true) with check (true);
drop policy if exists "Shared freelancers can be deleted" on public.freelancers;
create policy "Shared freelancers can be deleted" on public.freelancers for delete to anon using (true);
