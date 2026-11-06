-- Instalar con los esquemas de Archivo y Logistica existentes.
-- PREPARA el acceso; no cierra la app hasta que el instalador llame activate_app_access().
begin;
do $$ begin
  if to_regclass('public.pdf_documents') is null or to_regclass('public.logistics_departures') is null then
    raise exception 'Instalar primero Archivo PDF y Logistica.';
  end if;
end $$;

create table if not exists public.app_access_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('full', 'calendar'))
);
alter table public.app_access_roles enable row level security;
revoke all on public.app_access_roles from public, anon, authenticated;
grant select on public.app_access_roles to authenticated;
grant all on public.app_access_roles to service_role;
drop policy if exists app_role_self on public.app_access_roles;
create policy app_role_self on public.app_access_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.app_access_role() returns text
language sql stable security definer set search_path = public
as $$ select role from public.app_access_roles where user_id = auth.uid() $$;
revoke all on function public.app_access_role() from public, anon;
grant execute on function public.app_access_role() to authenticated, service_role;

create table if not exists public.app_access_credentials (
  role text primary key check (role in ('full', 'calendar')),
  email text not null unique,
  salt text not null,
  password_hash text not null,
  iterations integer not null check (iterations >= 310000)
);
alter table public.app_access_credentials enable row level security;
revoke all on public.app_access_credentials from public, anon, authenticated;
grant all on public.app_access_credentials to service_role;

create table if not exists public.app_login_attempts (
  scope text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
alter table public.app_login_attempts enable row level security;
revoke all on public.app_login_attempts from public, anon, authenticated;
grant all on public.app_login_attempts to service_role;
create or replace function public.consume_app_login_attempt(p_scope text, p_limit integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare attempt_count integer;
begin
  insert into public.app_login_attempts (scope, window_start, attempts) values (p_scope, now(), 1)
  on conflict (scope) do update set
    window_start = case when app_login_attempts.window_start < now() - interval '15 minutes' then now() else app_login_attempts.window_start end,
    attempts = case when app_login_attempts.window_start < now() - interval '15 minutes' then 1 else app_login_attempts.attempts + 1 end
  returning attempts into attempt_count;
  return attempt_count <= p_limit;
end $$;
revoke all on function public.consume_app_login_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.consume_app_login_attempt(text, integer) to service_role;

create or replace view public.app_calendar_departures with (security_barrier = true) as
select id, loading_at, departure_at, origin, truck_type, stops, deleted, created_at
from public.logistics_departures
where not deleted and public.app_access_role() in ('full', 'calendar');
create or replace view public.app_calendar_events with (security_barrier = true) as
select id, os, lugar, sala, area, armado, desarme, created_at,
  jsonb_build_object('event_id', event_data->>'event_id', 'ev', jsonb_build_object('evento', event_data->'ev'->>'evento')) as event_data
from public.pdf_documents where public.app_access_role() in ('full', 'calendar');
revoke all on public.app_calendar_departures, public.app_calendar_events from public, anon;
grant select on public.app_calendar_departures, public.app_calendar_events to authenticated;

create table if not exists public.departure_notification_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.departure_notification_admins enable row level security;
revoke all on public.departure_notification_admins from public, anon, authenticated;
grant select on public.departure_notification_admins to authenticated;
grant all on public.departure_notification_admins to service_role;
drop policy if exists app_notification_admin_self on public.departure_notification_admins;
create policy app_notification_admin_self on public.departure_notification_admins for select to authenticated using (user_id = auth.uid());

create or replace function public.activate_app_access() returns void
language plpgsql security definer set search_path = public as $$
declare table_name text; policy_row record;
begin
  if (select count(*) from public.app_access_credentials c join auth.users u on u.email = c.email
      join public.app_access_roles r on r.user_id = u.id and r.role = c.role) <> 2 then
    raise exception 'Faltan las dos cuentas verificadas. No se activa el bloqueo.';
  end if;
  foreach table_name in array array['pdf_documents','inventory_categories','inventory_items','inventory_combos',
    'inventory_combo_items','freelancers','deposit_checklists','deposit_checklist_items','logistics_departures',
    'logistics_catalog','departure_notification_recipients'] loop
    if to_regclass('public.' || table_name) is null then continue; end if;
    execute format('alter table public.%I enable row level security', table_name);
    for policy_row in select policyname from pg_policies where schemaname = 'public' and tablename = table_name loop
      execute format('drop policy %I on public.%I', policy_row.policyname, table_name);
    end loop;
    execute format('revoke all on public.%I from public, anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('create policy app_full on public.%I for all to authenticated using (public.app_access_role() = %L) with check (public.app_access_role() = %L)', table_name, 'full', 'full');
  end loop;
  create policy app_read_planillas on public.pdf_documents for select to authenticated using (public.app_access_role() = 'calendar');
  -- Legacy maintenance RPC must not let a read-only user delete checklists.
  if to_regprocedure('public.delete_expired_deposit_checklists()') is not null then
    revoke all on function public.delete_expired_deposit_checklists() from public, anon, authenticated;
    grant execute on function public.delete_expired_deposit_checklists() to service_role;
  end if;
  update storage.buckets set public = false where id = 'planillas';
  drop policy if exists app_storage_full on storage.objects;
  create policy app_storage_full on storage.objects for all to authenticated
    using (bucket_id = 'planillas' and public.app_access_role() = 'full')
    with check (bucket_id = 'planillas' and public.app_access_role() = 'full');
  drop policy if exists app_storage_read on storage.objects;
  create policy app_storage_read on storage.objects for select to authenticated
    using (bucket_id = 'planillas' and public.app_access_role() = 'calendar');
  -- Restrictive policies prevent legacy permissive policies from reopening this bucket.
  drop policy if exists app_storage_no_anon on storage.objects;
  create policy app_storage_no_anon on storage.objects as restrictive for all to anon
    using (bucket_id <> 'planillas') with check (bucket_id <> 'planillas');
  drop policy if exists app_storage_role_read on storage.objects;
  create policy app_storage_role_read on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'planillas' or public.app_access_role() in ('full', 'calendar'));
  drop policy if exists app_storage_role_insert on storage.objects;
  create policy app_storage_role_insert on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'planillas' or public.app_access_role() = 'full');
  drop policy if exists app_storage_role_update on storage.objects;
  create policy app_storage_role_update on storage.objects as restrictive for update to authenticated
    using (bucket_id <> 'planillas' or public.app_access_role() = 'full')
    with check (bucket_id <> 'planillas' or public.app_access_role() = 'full');
  drop policy if exists app_storage_role_delete on storage.objects;
  create policy app_storage_role_delete on storage.objects as restrictive for delete to authenticated
    using (bucket_id <> 'planillas' or public.app_access_role() = 'full');
end $$;
revoke all on function public.activate_app_access() from public, anon, authenticated;
grant execute on function public.activate_app_access() to service_role;
commit;
