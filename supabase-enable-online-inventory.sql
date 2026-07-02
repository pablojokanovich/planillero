-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Al abrir index.html, la app cargara automaticamente el catalogo actual
-- si estas tablas todavia estan vacias.

create extension if not exists pgcrypto;

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
