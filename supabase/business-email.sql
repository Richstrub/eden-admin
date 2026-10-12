-- Eden staff site: Business email (your Google Workspace mailboxes inside the staff site).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- How it works: the staff site never keeps copies of your email. Every time a mailbox is opened, the staff
-- site's worker asks Google (Gmail) for it, and every action (reply, delete, archive, move, star, mark read)
-- is done in Gmail itself, so Gmail and the staff site always show the same thing.
--
-- This file stores only:
--   mail_accounts  each connected mailbox's address and its Google "permission to use this mailbox" token.
--                  The token is locked (encrypted) by the worker with MAIL_TOKEN_KEY, a secret that exists only
--                  in Cloudflare, so the token is useless to anyone who reads this table. Nobody can read the
--                  table directly anyway: there are no read rules, only the functions below.
--   mail_access    who may open each mailbox. The Owner decides; a manager can connect their own mailbox.

create table if not exists public.mail_accounts (
  id            uuid primary key default gen_random_uuid(),
  address       text not null unique,
  name          text not null default '',
  token_enc     text not null,
  status        text not null default 'ok' check (status in ('ok', 'reconnect')),
  connected_by  uuid references auth.users (id) on delete set null default auth.uid(),
  connected_at  timestamptz not null default now()
);
create table if not exists public.mail_access (
  account_id  uuid not null references public.mail_accounts (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  primary key (account_id, user_id)
);
alter table public.mail_accounts enable row level security;
alter table public.mail_access enable row level security;
revoke all on public.mail_accounts, public.mail_access from anon, authenticated;
-- (no policies: the tables are reached only through the functions below)

create or replace function public.mail_can_open(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.staff_role() in ('owner', 'manager')
     and exists (select 1 from public.mail_access a where a.account_id = p_account and a.user_id = auth.uid())
$$;

-- The mailboxes you can open (the Owner also sees every mailbox and who can open it, to manage access)
create or replace function public.mail_my_accounts() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'address', m.address, 'name', m.name, 'status', m.status, 'connected_at', m.connected_at,
      'mine', exists (select 1 from public.mail_access a where a.account_id = m.id and a.user_id = auth.uid()),
      'people', case when public.staff_role() = 'owner' then coalesce((
          select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', coalesce(s.name, '')) order by s.name)
          from public.mail_access a left join public.staff s on s.user_id = a.user_id where a.account_id = m.id), '[]'::jsonb)
        else null end
    ) order by m.address), '[]'::jsonb)
  from public.mail_accounts m
  where public.staff_role() = 'owner'
     or (public.staff_role() = 'manager' and exists (select 1 from public.mail_access a where a.account_id = m.id and a.user_id = auth.uid()))
$$;

-- The worker asks for the locked token of a mailbox you may open (it can only unlock it with MAIL_TOKEN_KEY)
create or replace function public.mail_token(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.mail_accounts;
begin
  if not public.mail_can_open(p_account) then return jsonb_build_object('error', 'access'); end if;
  select * into m from public.mail_accounts where id = p_account;
  if not found then return jsonb_build_object('error', 'access'); end if;
  return jsonb_build_object('address', m.address, 'name', m.name, 'token', m.token_enc);
end $$;

-- After signing in with Google: save (or reconnect) a mailbox and give p_for access to it.
-- The Owner can connect a mailbox for anyone on the Owner/manager list; a manager only for themselves.
create or replace function public.mail_save_account(p_address text, p_name text, p_token text, p_for uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r text := public.staff_role(); m public.mail_accounts; addr text := lower(trim(p_address));
begin
  if r is null or r not in ('owner', 'manager') then return jsonb_build_object('error', 'access'); end if;
  if p_for is null then p_for := auth.uid(); end if;
  if r <> 'owner' and p_for <> auth.uid() then return jsonb_build_object('error', 'access'); end if;
  if not exists (select 1 from public.staff where user_id = p_for and role in ('owner', 'manager')) then return jsonb_build_object('error', 'person'); end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or coalesce(p_token, '') = '' then return jsonb_build_object('error', 'bad'); end if;
  select * into m from public.mail_accounts where address = addr;
  if found then
    -- reconnecting someone else's mailbox needs the Owner, or access to it already
    if r <> 'owner' and not exists (select 1 from public.mail_access where account_id = m.id and user_id = auth.uid()) then
      return jsonb_build_object('error', 'taken');
    end if;
    update public.mail_accounts set token_enc = p_token, name = coalesce(nullif(trim(p_name), ''), name), status = 'ok',
      connected_by = auth.uid(), connected_at = now() where id = m.id;
  else
    insert into public.mail_accounts (address, name, token_enc) values (addr, coalesce(trim(p_name), ''), p_token) returning * into m;
  end if;
  insert into public.mail_access (account_id, user_id) values (m.id, p_for) on conflict do nothing;
  return jsonb_build_object('id', m.id, 'address', addr);
end $$;

-- Google refused the saved permission (password changed, access removed in Google): show "Reconnect"
create or replace function public.mail_needs_reconnect(p_account uuid) returns void
language sql security definer set search_path = public as $$
  update public.mail_accounts set status = 'reconnect' where id = p_account and public.mail_can_open(p_account)
$$;

-- Owner: give or take away someone's access to a mailbox
create or replace function public.mail_set_access(p_account uuid, p_user uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.staff_role() is distinct from 'owner' then return jsonb_build_object('error', 'access'); end if;
  if p_on then
    if not exists (select 1 from public.staff where user_id = p_user and role in ('owner', 'manager')) then return jsonb_build_object('error', 'person'); end if;
    insert into public.mail_access (account_id, user_id) values (p_account, p_user) on conflict do nothing;
  else
    delete from public.mail_access where account_id = p_account and user_id = p_user;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Owner: disconnect a mailbox from the staff site (returns the locked token once, so the worker can
-- also cancel the permission at Google). The mailbox itself and its email are not touched.
create or replace function public.mail_remove(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; a text;
begin
  if public.staff_role() is distinct from 'owner' then return jsonb_build_object('error', 'access'); end if;
  delete from public.mail_accounts where id = p_account returning token_enc, address into t, a;
  return jsonb_build_object('ok', t is not null, 'token', t, 'address', a);
end $$;

-- when someone stops being a manager or the Owner, their mailbox access goes with it
create or replace function public.mail_access_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or new.role not in ('owner', 'manager') then
    delete from public.mail_access where user_id = old.user_id;
  end if;
  return null;
end $$;
drop trigger if exists staff_mail_access on public.staff;
create trigger staff_mail_access after update of role or delete on public.staff
  for each row execute function public.mail_access_cleanup();

revoke all on function public.mail_can_open(uuid), public.mail_my_accounts(), public.mail_token(uuid),
  public.mail_save_account(text, text, text, uuid), public.mail_needs_reconnect(uuid),
  public.mail_set_access(uuid, uuid, boolean), public.mail_remove(uuid) from public, anon;
grant execute on function public.mail_can_open(uuid), public.mail_my_accounts(), public.mail_token(uuid),
  public.mail_save_account(text, text, text, uuid), public.mail_needs_reconnect(uuid),
  public.mail_set_access(uuid, uuid, boolean), public.mail_remove(uuid) to authenticated;
