-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Agrega el tipo de alimentación al listado compartido de freelancers.

alter table public.freelancers
add column if not exists alimentacion text not null default 'comun';

alter table public.freelancers
drop constraint if exists freelancers_alimentacion_check;

alter table public.freelancers
add constraint freelancers_alimentacion_check
check (alimentacion in ('comun', 'vegetariano', 'sin_tacc'));

grant select, insert, update, delete on table public.freelancers to anon;
