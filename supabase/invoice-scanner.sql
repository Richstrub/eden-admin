-- Eden staff site: Inventory → scanned invoices from a Google Drive folder.
-- Run AFTER supabase/invoices.sql (and inquiries.sql, which makes the private INQUIRY_KEY check). Safe to run more than once.
--
-- The scanner on the office Mac saves each scan (PDF) into a Google Drive folder. Every 5 minutes the staff site's worker
-- looks in that folder, reads any new invoice with Claude and puts it in inventory_inbox as "waiting". On the Inventory page
-- you open a waiting invoice, check its lines and update prices, exactly like a photo.
--
-- inventory_drive  the one connected Google Drive (address, its locked permission token, the folder). Nobody can read it
--                  directly; the worker gets it with the private INQUIRY_KEY.
-- inventory_inbox  each scanned file: waiting / couldn't read / done / dismissed, with what Claude read.

create table if not exists public.inventory_drive (
  id          int primary key default 1 check (id = 1),
  address     text not null default '',
  token_enc   text not null default '',
  folder_id   text not null default '',
  folder_name text not null default '',
  status      text not null default 'ok',          -- ok | reconnect | nofolder
  last_check  timestamptz,
  last_error  text not null default '',
  updated_at  timestamptz not null default now()
);
alter table public.inventory_drive enable row level security;
revoke all on public.inventory_drive from anon, authenticated;

create table if not exists public.inventory_inbox (
  id           uuid primary key default gen_random_uuid(),
  file_id      text not null unique,                -- Google Drive file id
  file_name    text not null default '',
  file_created timestamptz,
  status       text not null default 'waiting' check (status in ('waiting', 'error', 'done', 'dismissed')),
  invoice      jsonb,                               -- what Claude read: vendor, invoice_no, date, total, lines
  error        text not null default '',
  invoice_id   uuid references public.inventory_invoices (id) on delete set null,
  created_at   timestamptz not null default now(),
  done_at      timestamptz
);
create index if not exists inventory_inbox_status on public.inventory_inbox (status, created_at desc);
alter table public.inventory_inbox enable row level security;
revoke all on public.inventory_inbox from anon;
grant select, update, delete on public.inventory_inbox to authenticated;
drop policy if exists "inventory" on public.inventory_inbox;
create policy "inventory" on public.inventory_inbox for all to authenticated using (public.can_inventory()) with check (public.can_inventory());

-- staff site: is a folder connected? (no token)
create or replace function public.inv_drive_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.can_inventory() then jsonb_build_object('error', 'denied')
    else coalesce((select jsonb_build_object('address', d.address, 'folder', d.folder_name, 'folder_id', d.folder_id, 'status', d.status,
      'last_check', d.last_check, 'last_error', d.last_error, 'can_change', public.access_level() in ('owner', 'manager'))
      from public.inventory_drive d where d.id = 1 and d.token_enc <> ''), jsonb_build_object('address', '', 'can_change', public.access_level() in ('owner', 'manager'))) end
$$;
-- Owner or a manager connects Google Drive (the worker locks the token before it gets here)
create or replace function public.inv_drive_save(p_address text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.access_level() not in ('owner', 'manager') then return jsonb_build_object('error', 'denied'); end if;
  insert into public.inventory_drive (id, address, token_enc, status, last_error, updated_at) values (1, lower(trim(p_address)), p_token, 'nofolder', '', now())
  on conflict (id) do update set address = excluded.address, token_enc = excluded.token_enc,
    status = case when public.inventory_drive.folder_id <> '' then 'ok' else 'nofolder' end, last_error = '', updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.inv_drive_remove() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if public.access_level() not in ('owner', 'manager') then return jsonb_build_object('error', 'denied'); end if;
  select token_enc || '|' || address into t from public.inventory_drive where id = 1;
  delete from public.inventory_drive where id = 1;
  return jsonb_build_object('ok', true, 'token', coalesce(t, ''));
end $$;
-- the worker, signed in as the person: their token to look the folder up (Owner or manager only)
create or replace function public.inv_drive_token() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.access_level() not in ('owner', 'manager') then jsonb_build_object('error', 'denied')
    else coalesce((select jsonb_build_object('address', address, 'token', token_enc) from public.inventory_drive where id = 1 and token_enc <> ''), jsonb_build_object('error', 'not_connected')) end
$$;
create or replace function public.inv_drive_set_folder(p_folder_id text, p_folder_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.access_level() not in ('owner', 'manager') then return jsonb_build_object('error', 'denied'); end if;
  update public.inventory_drive set folder_id = p_folder_id, folder_name = p_folder_name, status = 'ok', last_error = '', updated_at = now() where id = 1;
  return jsonb_build_object('ok', found);
end $$;
revoke all on function public.inv_drive_status(), public.inv_drive_save(text, text), public.inv_drive_remove(), public.inv_drive_token(), public.inv_drive_set_folder(text, text) from public, anon;
grant execute on function public.inv_drive_status(), public.inv_drive_save(text, text), public.inv_drive_remove(), public.inv_drive_token(), public.inv_drive_set_folder(text, text) to authenticated;

-- the worker's 5-minute check (private INQUIRY_KEY)
create or replace function public.inv_drive_server(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.inventory_drive;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  select * into d from public.inventory_drive where id = 1;
  if not found or d.token_enc = '' then return jsonb_build_object('error', 'not_connected'); end if;
  return jsonb_build_object('address', d.address, 'token', d.token_enc, 'folder_id', d.folder_id, 'status', d.status,
    'seen', coalesce((select jsonb_agg(file_id) from public.inventory_inbox where created_at > now() - interval '120 days'), '[]'::jsonb));
end $$;
create or replace function public.inv_inbox_add_server(p_key text, p_file_id text, p_name text, p_created timestamptz, p_status text, p_invoice jsonb, p_error text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  insert into public.inventory_inbox (file_id, file_name, file_created, status, invoice, error)
  values (p_file_id, coalesce(p_name, ''), p_created, case when p_status = 'error' then 'error' else 'waiting' end, p_invoice, coalesce(p_error, ''))
  on conflict (file_id) do update set invoice = coalesce(excluded.invoice, public.inventory_inbox.invoice), error = excluded.error,
    status = case when public.inventory_inbox.status in ('done', 'dismissed') then public.inventory_inbox.status else excluded.status end;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.inv_drive_checked_server(p_key text, p_error text, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  update public.inventory_drive set last_check = now(), last_error = coalesce(p_error, ''), status = coalesce(nullif(p_status, ''), status) where id = 1;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.inv_drive_server(text), public.inv_inbox_add_server(text, text, text, timestamptz, text, jsonb, text), public.inv_drive_checked_server(text, text, text) from public, authenticated;
grant execute on function public.inv_drive_server(text), public.inv_inbox_add_server(text, text, text, timestamptz, text, jsonb, text), public.inv_drive_checked_server(text, text, text) to anon;
