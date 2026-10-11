-- Eden staff site: Catering & BEOs > Inquiries.
-- Catering questionnaires sent from the public website (edencny.com/#catering) arrive here instead of
-- by email. They come in through the staff site's web worker (worker.js), which first screens out bots
-- (Cloudflare Turnstile, a hidden trap field, a too-fast check, a per-connection limit and sanity checks)
-- and, when email sending is set up, asks the guest to confirm their email address before it reaches you.
-- Owner and managers can read and work the inquiries; nobody else, and the website itself can't read them.
--
-- Only the worker can add inquiries: it must present a private "inquiry key" that only it and this
-- database know (the public website key alone is not enough, so bots can't skip the checks).
--
-- Run AFTER schedule.sql. Paste into Supabase > SQL Editor > New query, click Run. Safe to run again.
-- Then, once, run:   select public.new_inquiry_key();
-- and paste the result into Cloudflare as the eden-admin worker's secret INQUIRY_KEY (see README).

create table if not exists public.catering_inquiries (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  status        text not null default 'new' check (status in ('unconfirmed', 'new', 'contacted', 'booked', 'declined', 'spam')),
  confirmed_at  timestamptz,
  name          text not null default '',
  email         text not null default '',
  phone         text not null default '',
  organization  text not null default '',
  event_name    text not null default '',
  event_type    text not null default '',
  event_date    date,
  start_time    text not null default '',
  end_time      text not null default '',
  guests        integer,
  location      text not null default '',
  estimate      numeric(10, 2),
  summary       jsonb not null default '[]'::jsonb,   -- what they chose, in words
  beo           jsonb not null default '{}'::jsonb,   -- the answers mapped onto the BEO form
  answers       jsonb not null default '{}'::jsonb,   -- everything they entered
  guest_notes   text not null default '',
  flags         text[] not null default '{}',         -- e.g. email-not-sent
  staff_note    text not null default '',
  calendar_event text,                                -- calendar event made from it, if any
  ip_hash       text not null default '',             -- anonymous, for the per-connection limit
  token_hash    text not null default '',             -- for the guest's "confirm my email" link
  updated_by    uuid
);
create index if not exists catering_inquiries_created on public.catering_inquiries (created_at desc);
create index if not exists catering_inquiries_ip on public.catering_inquiries (ip_hash, created_at desc);

alter table public.catering_inquiries enable row level security;
revoke all on public.catering_inquiries from anon;
grant select, update, delete on public.catering_inquiries to authenticated;
drop policy if exists "managers read inquiries" on public.catering_inquiries;
create policy "managers read inquiries" on public.catering_inquiries for select to authenticated using (public.can_schedule());
drop policy if exists "managers update inquiries" on public.catering_inquiries;
create policy "managers update inquiries" on public.catering_inquiries for update to authenticated using (public.can_schedule()) with check (public.can_schedule());
drop policy if exists "owner deletes inquiries" on public.catering_inquiries;
create policy "owner deletes inquiries" on public.catering_inquiries for delete to authenticated using (public.staff_role() = 'owner');

create or replace function public.inquiry_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;
drop trigger if exists inquiry_touch on public.catering_inquiries;
create trigger inquiry_touch before update on public.catering_inquiries for each row execute function public.inquiry_touch();

-- Private settings only database functions can read (no one can read this table through the website or staff site).
create table if not exists public.app_secrets (name text primary key, value text not null, created_at timestamptz not null default now());
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- Makes (or replaces) the inquiry key and shows it once. Run it in the SQL Editor; the website can't call it.
create or replace function public.new_inquiry_key() returns text
language plpgsql security definer set search_path = public as $$
declare k text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.app_secrets (name, value) values ('inquiry_key', k)
    on conflict (name) do update set value = excluded.value, created_at = now();
  return k;
end $$;
revoke all on function public.new_inquiry_key() from public, anon, authenticated;

create or replace function public.inquiry_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(length(p_key) >= 32 and p_key = (select value from public.app_secrets where name = 'inquiry_key'), false)
$$;
revoke all on function public.inquiry_key_ok(text) from public, anon, authenticated;

-- Called by the worker after its checks. Returns {id, token} or {error}.
drop function if exists public.submit_inquiry(text, text, jsonb, boolean);
create or replace function public.submit_inquiry(p_key text, p_ip text, p_row jsonb, p_unconfirmed boolean default false, p_spam boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb := coalesce(p_row, '{}'::jsonb);
  tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  new_id uuid; em text := lower(left(trim(coalesce(r ->> 'email', '')), 200));
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  -- no more than 3 from one connection an hour, or 3 for one email address a day
  if (select count(*) from public.catering_inquiries where ip_hash = coalesce(p_ip, '') and p_ip <> '' and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.catering_inquiries where lower(email) = em and em <> '' and created_at > now() - interval '1 day') >= 3 then
    return jsonb_build_object('error', 'rate');
  end if;
  insert into public.catering_inquiries (status, name, email, phone, organization, event_name, event_type, event_date, start_time, end_time,
      guests, location, estimate, summary, beo, answers, guest_notes, flags, ip_hash, token_hash)
  values (case when p_spam then 'spam' when p_unconfirmed then 'unconfirmed' else 'new' end,
      left(coalesce(r ->> 'name', ''), 120), em, left(coalesce(r ->> 'phone', ''), 40), left(coalesce(r ->> 'organization', ''), 160),
      left(coalesce(r ->> 'event_name', ''), 160), left(coalesce(r ->> 'event_type', ''), 40),
      case when coalesce(r ->> 'event_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'event_date')::date end,
      left(coalesce(r ->> 'start_time', ''), 10), left(coalesce(r ->> 'end_time', ''), 10),
      case when coalesce(r ->> 'guests', '') ~ '^\d{1,5}$' then (r ->> 'guests')::int end,
      left(coalesce(r ->> 'location', ''), 240),
      case when coalesce(r ->> 'estimate', '') ~ '^\d{1,8}(\.\d+)?$' then round((r ->> 'estimate')::numeric, 2) end,
      case when jsonb_typeof(r -> 'summary') = 'array' then r -> 'summary' else '[]'::jsonb end,
      case when jsonb_typeof(r -> 'beo') = 'object' then r -> 'beo' else '{}'::jsonb end,
      case when jsonb_typeof(r -> 'answers') = 'object' then r -> 'answers' else '{}'::jsonb end,
      left(coalesce(r ->> 'guest_notes', ''), 4000),
      coalesce((select array_agg(left(x, 40)) from jsonb_array_elements_text(case when jsonb_typeof(r -> 'flags') = 'array' then r -> 'flags' else '[]'::jsonb end) x), '{}'),
      left(coalesce(p_ip, ''), 64), encode(sha256(convert_to(tok, 'utf8')), 'hex'))
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'token', tok);
end $$;
revoke all on function public.submit_inquiry(text, text, jsonb, boolean, boolean) from public;
grant execute on function public.submit_inquiry(text, text, jsonb, boolean, boolean) to anon, authenticated;

-- The guest clicked "confirm" in their email. Returns the inquiry (for the staff notice) or {error}.
-- p_unverified: the confirmation email couldn't be sent, so let it through unconfirmed (flagged) rather than lose it.
drop function if exists public.confirm_inquiry(text, text);
create or replace function public.confirm_inquiry(p_key text, p_token text, p_unverified boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.catering_inquiries;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  select * into q from public.catering_inquiries
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex') and coalesce(p_token, '') <> '' limit 1;
  if q.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if q.status <> 'unconfirmed' then return jsonb_build_object('already', true, 'id', q.id); end if;
  if q.created_at < now() - interval '14 days' then return jsonb_build_object('error', 'expired'); end if;
  if p_unverified then
    update public.catering_inquiries set status = 'new', flags = array_append(flags, 'email-not-sent') where id = q.id;
  else
    update public.catering_inquiries set status = 'new', confirmed_at = now() where id = q.id;
  end if;
  return jsonb_build_object('id', q.id, 'name', q.name, 'email', q.email, 'phone', q.phone, 'event_name', q.event_name,
    'event_date', q.event_date, 'guests', q.guests, 'location', q.location, 'estimate', q.estimate);
end $$;
revoke all on function public.confirm_inquiry(text, text, boolean) from public;
grant execute on function public.confirm_inquiry(text, text, boolean) to anon, authenticated;

-- Record staff changes in History (if History is set up).
do $$
begin
  if to_regprocedure('public.log_activity()') is not null then
    drop trigger if exists log_activity on public.catering_inquiries;
    create trigger log_activity after update or delete on public.catering_inquiries for each row
      when (auth.uid() is not null) execute function public.log_activity();   -- staff changes, not the guest's confirm click
  end if;
end $$;
