-- Ejecutar una vez en Supabase > SQL Editor para compartir choferes y destinos.
create table if not exists public.logistics_catalog (
  id text primary key,
  kind text not null check (kind in ('driver', 'destination')),
  name text not null check (length(trim(name)) > 0),
  address text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists logistics_catalog_name_idx
on public.logistics_catalog (kind, lower(trim(name)));

insert into public.logistics_catalog (id, kind, name) values
  ('driver-jonathan-robles', 'driver', 'Jonathan Robles'),
  ('driver-emanuel-ledesma', 'driver', 'Emanuel Ledesma'),
  ('destination-centro-convenciones', 'destination', 'Centro de Convenciones'),
  ('destination-la-rural', 'destination', 'La Rural'),
  ('destination-sheraton-retiro', 'destination', 'Sheraton Retiro'),
  ('destination-sheraton-greenville', 'destination', 'Sheraton Greenville'),
  ('destination-ba-ferial', 'destination', 'BA Ferial'),
  ('destination-deposito-central', 'destination', 'Depósito Central')
on conflict do nothing;

alter table public.logistics_catalog enable row level security;
grant select, insert, update on public.logistics_catalog to anon;
drop policy if exists "Logistics catalog can be read" on public.logistics_catalog;
create policy "Logistics catalog can be read" on public.logistics_catalog for select to anon using (true);
drop policy if exists "Logistics catalog can be created" on public.logistics_catalog;
create policy "Logistics catalog can be created" on public.logistics_catalog for insert to anon with check (true);
drop policy if exists "Logistics catalog can be updated" on public.logistics_catalog;
create policy "Logistics catalog can be updated" on public.logistics_catalog for update to anon using (true) with check (true);
