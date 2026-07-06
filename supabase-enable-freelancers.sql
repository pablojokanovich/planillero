-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Crea el listado compartido de freelancers. Al volver a abrir citaciones.html,
-- la app cargara automaticamente los freelancers incluidos en el HTML.

create table if not exists public.freelancers (
  id bigint primary key,
  nombre text not null check (length(trim(nombre)) > 0),
  area text not null check (area in ('CCTV', 'Sonido', 'Iluminacion', 'Video', 'Traduccion', 'Computers', 'Otros')),
  telefono text not null default '',
  created_at timestamptz not null default now()
);

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
