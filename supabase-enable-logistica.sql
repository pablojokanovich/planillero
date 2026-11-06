-- Ejecutar una vez en Supabase > SQL Editor para compartir las salidas.
create table if not exists public.logistics_departures (
  id uuid primary key default gen_random_uuid(),
  loading_at timestamp without time zone not null,
  departure_at timestamp without time zone not null,
  origin text not null check (length(trim(origin)) > 0),
  truck_type text not null check (truck_type in ('Sprinter', 'Iveco', 'Mercedes Benz')),
  driver text not null check (length(trim(driver)) > 0),
  stops jsonb not null check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) > 0),
  notes text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (loading_at <= departure_at)
);

create index if not exists logistics_departures_time_idx on public.logistics_departures (departure_at, id);
alter table public.logistics_departures enable row level security;
grant select, insert, update on public.logistics_departures to anon;

drop policy if exists "Shared departures can be read" on public.logistics_departures;
create policy "Shared departures can be read" on public.logistics_departures for select to anon using (true);
drop policy if exists "Shared departures can be created" on public.logistics_departures;
create policy "Shared departures can be created" on public.logistics_departures for insert to anon with check (true);
drop policy if exists "Shared departures can be updated" on public.logistics_departures;
create policy "Shared departures can be updated" on public.logistics_departures for update to anon using (true) with check (true);
