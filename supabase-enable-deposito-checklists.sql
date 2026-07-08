-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Habilita planillas online de deposito para marcar equipos guardados.

create extension if not exists pgcrypto;

create table if not exists public.deposit_checklists (
  id uuid primary key default gen_random_uuid(),
  pdf_document_id uuid references public.pdf_documents(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  os text,
  lugar text,
  sala text,
  area text,
  armado text,
  desarme text,
  lider text,
  total_items integer not null default 0 check (total_items >= 0),
  expires_at timestamptz not null default (now() + interval '60 days'),
  created_at timestamptz not null default now()
);

create table if not exists public.deposit_checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.deposit_checklists(id) on delete cascade,
  sala text,
  area text,
  category text,
  equipment text not null,
  quantity integer not null default 1 check (quantity > 0),
  observations text,
  checked boolean not null default false,
  checked_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists deposit_checklists_pdf_idx on public.deposit_checklists (pdf_document_id);
create index if not exists deposit_checklists_token_idx on public.deposit_checklists (token);
create index if not exists deposit_checklists_expires_idx on public.deposit_checklists (expires_at);
create index if not exists deposit_checklist_items_checklist_idx on public.deposit_checklist_items (checklist_id, sort_order);

alter table public.deposit_checklists enable row level security;
alter table public.deposit_checklist_items enable row level security;

grant select, insert, update, delete on table public.deposit_checklists to anon;
grant select, insert, update, delete on table public.deposit_checklist_items to anon;

drop policy if exists "Deposit checklists can be read" on public.deposit_checklists;
create policy "Deposit checklists can be read"
on public.deposit_checklists for select to anon
using (true);

drop policy if exists "Deposit checklists can be created" on public.deposit_checklists;
create policy "Deposit checklists can be created"
on public.deposit_checklists for insert to anon
with check (total_items >= 0);

drop policy if exists "Deposit checklists can be updated" on public.deposit_checklists;
create policy "Deposit checklists can be updated"
on public.deposit_checklists for update to anon
using (true)
with check (true);

drop policy if exists "Deposit checklists can be deleted" on public.deposit_checklists;
create policy "Deposit checklists can be deleted"
on public.deposit_checklists for delete to anon
using (true);

drop policy if exists "Deposit checklist items can be read" on public.deposit_checklist_items;
create policy "Deposit checklist items can be read"
on public.deposit_checklist_items for select to anon
using (true);

drop policy if exists "Deposit checklist items can be created" on public.deposit_checklist_items;
create policy "Deposit checklist items can be created"
on public.deposit_checklist_items for insert to anon
with check (quantity > 0);

drop policy if exists "Deposit checklist items can be updated" on public.deposit_checklist_items;
create policy "Deposit checklist items can be updated"
on public.deposit_checklist_items for update to anon
using (true)
with check (quantity > 0);

drop policy if exists "Deposit checklist items can be deleted" on public.deposit_checklist_items;
create policy "Deposit checklist items can be deleted"
on public.deposit_checklist_items for delete to anon
using (true);

create or replace function public.delete_expired_deposit_checklists()
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer;
begin
  delete from public.deposit_checklists
  where expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.delete_expired_deposit_checklists() to anon;
