-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Crea el listado compartido de freelancers. Al volver a abrir citaciones.html,
-- la app cargara automaticamente los freelancers incluidos en el HTML.

create table if not exists public.freelancers (
  id bigint primary key,
  nombre text not null check (length(trim(nombre)) > 0),
  area text not null check (area in ('CCTV', 'Sonido', 'Iluminacion', 'Video', 'Traduccion', 'Computers', 'Otros')),
  telefono text not null default '',
  alimentacion text not null default 'comun' check (alimentacion in ('comun', 'vegetariano', 'sin_tacc')),
  created_at timestamptz not null default now()
);

-- Mantiene compatible una tabla creada con una versión anterior.
alter table public.freelancers add column if not exists alimentacion text not null default 'comun';
alter table public.freelancers drop constraint if exists freelancers_alimentacion_check;
alter table public.freelancers add constraint freelancers_alimentacion_check
check (alimentacion in ('comun', 'vegetariano', 'sin_tacc'));

create index if not exists freelancers_area_nombre_idx
on public.freelancers (area, nombre);

alter table public.freelancers enable row level security;
grant select, insert, update, delete on table public.freelancers to anon;

drop policy if exists "Shared freelancers can be read" on public.freelancers;
create policy "Shared freelancers can be read"
on public.freelancers for select to anon using (true);

drop policy if exists "Shared freelancers can be created" on public.freelancers;
create policy "Shared freelancers can be created"
on public.freelancers for insert to anon with check (true);

drop policy if exists "Shared freelancers can be updated" on public.freelancers;
create policy "Shared freelancers can be updated"
on public.freelancers for update to anon using (true) with check (true);

drop policy if exists "Shared freelancers can be deleted" on public.freelancers;
create policy "Shared freelancers can be deleted"
on public.freelancers for delete to anon using (true);
