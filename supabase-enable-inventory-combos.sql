-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Habilita combos compartidos para el inventario online.

create extension if not exists pgcrypto;

create table if not exists public.inventory_combos (
  id uuid primary key default gen_random_uuid(),
  combo_key text not null unique,
  area text not null check (area in ('cctv', 'sonido', 'video', 'luces')),
  category_name text not null check (length(trim(category_name)) > 0),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (area, category_name, name)
);

create table if not exists public.inventory_combo_items (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references public.inventory_combos(id) on delete cascade,
  item_area text not null check (item_area in ('cctv', 'sonido', 'video', 'luces')),
  category_name text not null check (length(trim(category_name)) > 0),
  item_name text not null check (length(trim(item_name)) > 0),
  qty integer not null default 1 check (qty > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists inventory_combos_order_idx on public.inventory_combos (area, category_name, sort_order);
create index if not exists inventory_combo_items_combo_order_idx on public.inventory_combo_items (combo_id, sort_order);

alter table public.inventory_combos enable row level security;
alter table public.inventory_combo_items enable row level security;

grant select, insert, update, delete on table public.inventory_combos to anon;
grant select, insert, update, delete on table public.inventory_combo_items to anon;

drop policy if exists "Shared inventory combos can be read" on public.inventory_combos;
create policy "Shared inventory combos can be read" on public.inventory_combos for select to anon using (true);
drop policy if exists "Shared inventory combos can be created" on public.inventory_combos;
create policy "Shared inventory combos can be created" on public.inventory_combos for insert to anon with check (true);
drop policy if exists "Shared inventory combos can be updated" on public.inventory_combos;
create policy "Shared inventory combos can be updated" on public.inventory_combos for update to anon using (true) with check (true);
drop policy if exists "Shared inventory combos can be deleted" on public.inventory_combos;
create policy "Shared inventory combos can be deleted" on public.inventory_combos for delete to anon using (true);

drop policy if exists "Shared inventory combo items can be read" on public.inventory_combo_items;
create policy "Shared inventory combo items can be read" on public.inventory_combo_items for select to anon using (true);
drop policy if exists "Shared inventory combo items can be created" on public.inventory_combo_items;
create policy "Shared inventory combo items can be created" on public.inventory_combo_items for insert to anon with check (true);
drop policy if exists "Shared inventory combo items can be updated" on public.inventory_combo_items;
create policy "Shared inventory combo items can be updated" on public.inventory_combo_items for update to anon using (true) with check (true);
drop policy if exists "Shared inventory combo items can be deleted" on public.inventory_combo_items;
create policy "Shared inventory combo items can be deleted" on public.inventory_combo_items for delete to anon using (true);
