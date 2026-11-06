-- Preparar despues de supabase-enable-logistica.sql.
-- No cambia el acceso anonimo existente al resto de la aplicacion.
create table if not exists public.departure_notification_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.departure_notification_admins enable row level security;
revoke all on public.departure_notification_admins from anon;
grant select on public.departure_notification_admins to authenticated;
drop policy if exists "Notification admins can see their membership" on public.departure_notification_admins;
create policy "Notification admins can see their membership" on public.departure_notification_admins
for select to authenticated using (user_id = auth.uid());

create table if not exists public.departure_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists departure_notification_email_idx
on public.departure_notification_recipients (lower(trim(email)));
alter table public.departure_notification_recipients enable row level security;
revoke all on public.departure_notification_recipients from anon;
grant select, insert, update on public.departure_notification_recipients to authenticated;
drop policy if exists "Admins manage departure recipients" on public.departure_notification_recipients;
create policy "Admins manage departure recipients" on public.departure_notification_recipients
for all to authenticated
using (exists (select 1 from public.departure_notification_admins where user_id = auth.uid()))
with check (exists (select 1 from public.departure_notification_admins where user_id = auth.uid()));

alter table public.logistics_departures add column if not exists created_by uuid references auth.users(id);
create or replace function public.stamp_departure_creator() returns trigger
language plpgsql set search_path = public as $$
begin
  if TG_OP = 'INSERT' then new.created_by := auth.uid();
  else new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
drop trigger if exists stamp_departure_creator on public.logistics_departures;
create trigger stamp_departure_creator before insert or update on public.logistics_departures
for each row execute function public.stamp_departure_creator();
grant select, insert, update on public.logistics_departures to authenticated;
drop policy if exists "Notification admins can manage departures" on public.logistics_departures;
create policy "Notification admins can manage departures" on public.logistics_departures
for all to authenticated
using (exists (select 1 from public.departure_notification_admins where user_id = auth.uid()))
with check (exists (select 1 from public.departure_notification_admins where user_id = auth.uid()));

create table if not exists public.departure_notification_deliveries (
  departure_id uuid not null references public.logistics_departures(id) on delete cascade,
  recipient_id uuid not null references public.departure_notification_recipients(id) on delete cascade,
  provider_id text not null,
  sent_at timestamptz not null default now(),
  primary key (departure_id, recipient_id)
);
alter table public.departure_notification_deliveries enable row level security;
revoke all on public.departure_notification_deliveries from anon, authenticated;
grant select, insert, update on public.departure_notification_admins,
public.departure_notification_recipients, public.departure_notification_deliveries to service_role;

-- Crear/invitar primero los administradores en Supabase Authentication.
-- Habilitar cada cuenta desde SQL Editor, usando su UUID real:
-- insert into public.departure_notification_admins (user_id) values ('UUID-DE-LA-CUENTA');
