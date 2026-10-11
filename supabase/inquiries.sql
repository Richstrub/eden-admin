-- Eden staff site: Catering & BEOs.
-- How it works:
--   1. A guest sends the short inquiry form on the website (about them + their event). It comes in through the
--      staff site's web worker (worker.js), which screens out bots (Cloudflare Turnstile, a hidden trap field,
--      a too-fast check, per-connection limits and sanity checks), and lands here as a New inquiry.
--   2. A manager sends the guest a private link to the full questionnaire, already filled in with what they sent.
--   3. The guest finishes it; their menu choices come back to the same inquiry.
--   4. It becomes an active BEO (the BEO form is saved with the inquiry), then Completed after the event.
--   Every email to and from the guest, and each step, is kept in the inquiry's conversation thread.
-- Owner and managers can read and work the inquiries; nobody else, and the website itself can't read them.
--
-- Only the worker can add inquiries: it must present a private "inquiry key" that only it and this
-- database know (the public website key alone is not enough, so bots can't skip the checks).
--
-- Run AFTER schedule.sql and history.sql. Paste into Supabase > SQL Editor > New query, click Run. Safe to run again
-- (it updates an earlier setup in place). The first time only, then run:   select public.new_inquiry_key();
-- and paste the result into Cloudflare as the eden-admin worker's secret INQUIRY_KEY (see README).

create table if not exists public.catering_inquiries (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  status        text not null default 'new',
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
-- stages: new → link_sent (questionnaire sent) → received (questionnaire back) → beo (active BEO) → completed; or declined / spam
alter table public.catering_inquiries drop constraint if exists catering_inquiries_status_check;
update public.catering_inquiries set status = case status when 'unconfirmed' then 'new' when 'contacted' then 'new' when 'booked' then 'beo' else status end
  where status in ('unconfirmed', 'contacted', 'booked');
alter table public.catering_inquiries add constraint catering_inquiries_status_check
  check (status in ('new', 'link_sent', 'received', 'beo', 'completed', 'declined', 'spam'));
alter table public.catering_inquiries add column if not exists plan_token text not null default '';   -- the guest's questionnaire link
alter table public.catering_inquiries add column if not exists plan_sent_at timestamptz;
alter table public.catering_inquiries add column if not exists plan_done_at timestamptz;
alter table public.catering_inquiries add column if not exists beo_doc jsonb;                         -- the BEO form, as last saved
alter table public.catering_inquiries add column if not exists beo_saved_at timestamptz;
alter table public.catering_inquiries add column if not exists last_message_at timestamptz;
create unique index if not exists catering_inquiries_plan on public.catering_inquiries (plan_token) where plan_token <> '';
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

-- The conversation thread: emails to and from the guest, calls or emails staff log by hand, and each step.
create table if not exists public.inquiry_messages (
  id          uuid primary key default gen_random_uuid(),
  inquiry_id  uuid not null references public.catering_inquiries (id) on delete cascade,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('out', 'in', 'event', 'note')),   -- out = to the guest, in = from the guest
  from_addr   text not null default '',
  to_addr     text not null default '',
  subject     text not null default '',
  body        text not null default '',
  by_name     text not null default '',
  by_user     uuid,
  mail_status text not null default '',    -- sent, failed, sending; '' when logged by hand
  email_id    text not null default ''     -- the email service's id, so a reply is never stored twice
);
create index if not exists inquiry_messages_inq on public.inquiry_messages (inquiry_id, at);
create unique index if not exists inquiry_messages_email on public.inquiry_messages (email_id) where email_id <> '';
alter table public.inquiry_messages enable row level security;
revoke all on public.inquiry_messages from anon;
grant select, insert, update, delete on public.inquiry_messages to authenticated;
drop policy if exists "managers read messages" on public.inquiry_messages;
create policy "managers read messages" on public.inquiry_messages for select to authenticated using (public.can_schedule());
drop policy if exists "managers add messages" on public.inquiry_messages;
create policy "managers add messages" on public.inquiry_messages for insert to authenticated with check (public.can_schedule() and kind in ('out', 'in', 'note', 'event'));
drop policy if exists "managers update messages" on public.inquiry_messages;
create policy "managers update messages" on public.inquiry_messages for update to authenticated using (public.can_schedule()) with check (public.can_schedule());
drop policy if exists "owner deletes messages" on public.inquiry_messages;
create policy "owner deletes messages" on public.inquiry_messages for delete to authenticated using (public.staff_role() = 'owner');
create or replace function public.inquiry_message_added() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('out', 'in') then update public.catering_inquiries set last_message_at = new.at where id = new.inquiry_id; end if;
  return null;
end $$;
drop trigger if exists inquiry_message_added on public.inquiry_messages;
create trigger inquiry_message_added after insert on public.inquiry_messages for each row execute function public.inquiry_message_added();

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
  values (case when p_spam then 'spam' else 'new' end,
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
  insert into public.inquiry_messages (inquiry_id, kind, subject, body)
    values (new_id, 'event', 'Inquiry received from the website', case when p_spam then 'Filed under Spam by the bot checks.' else '' end);
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
  return jsonb_build_object('already', true, 'id', q.id);   -- email confirmation is no longer used
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

-- A manager makes (or reuses) the guest's private questionnaire link. Returns the code that goes in the link.
create or replace function public.create_plan_link(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare q public.catering_inquiries; tok text; who text;
begin
  if not coalesce(public.can_schedule(), false) then raise exception 'Only the Owner and managers can do this' using errcode = '42501'; end if;
  select * into q from public.catering_inquiries where id = p_id;
  if q.id is null then raise exception 'Inquiry not found'; end if;
  tok := nullif(q.plan_token, '');
  if tok is null then
    tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update public.catering_inquiries set plan_token = tok where id = p_id;
    who := coalesce((select s.name from public.staff s where s.user_id = auth.uid()), '');
    insert into public.inquiry_messages (inquiry_id, kind, subject, by_name, by_user) values (p_id, 'event', 'Questionnaire link created', who, auth.uid());
  end if;
  return tok;
end $$;
revoke all on function public.create_plan_link(uuid) from public, anon;
grant execute on function public.create_plan_link(uuid) to authenticated;

-- The guest opens their link: what they've told us so far. Called by the worker with the inquiry key.
create or replace function public.get_plan(p_key text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q public.catering_inquiries;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  if coalesce(p_token, '') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error', 'not_found'); end if;
  select * into q from public.catering_inquiries where plan_token = p_token;
  if q.id is null or q.status = 'spam' then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('answers', q.answers, 'done', q.plan_done_at is not null,
    'locked', q.status in ('beo', 'completed', 'declined'), 'name', q.name);
end $$;
revoke all on function public.get_plan(text, text) from public;
grant execute on function public.get_plan(text, text) to anon, authenticated;

-- The guest sends the full questionnaire. Returns the inquiry (for the staff notice) or {error}.
create or replace function public.submit_plan(p_key text, p_token text, p_row jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.catering_inquiries; r jsonb := coalesce(p_row, '{}'::jsonb); again boolean;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  if coalesce(p_token, '') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error', 'not_found'); end if;
  select * into q from public.catering_inquiries where plan_token = p_token;
  if q.id is null or q.status = 'spam' then return jsonb_build_object('error', 'not_found'); end if;
  if q.status in ('beo', 'completed', 'declined') then return jsonb_build_object('error', 'locked'); end if;
  again := q.plan_done_at is not null;
  update public.catering_inquiries set
    status = 'received', plan_done_at = now(),
    name = coalesce(nullif(left(r ->> 'name', 120), ''), name),
    email = coalesce(nullif(lower(left(trim(r ->> 'email'), 200)), ''), email),
    phone = left(coalesce(r ->> 'phone', phone), 40), organization = left(coalesce(r ->> 'organization', organization), 160),
    event_name = left(coalesce(r ->> 'event_name', event_name), 160), event_type = left(coalesce(r ->> 'event_type', event_type), 40),
    event_date = case when coalesce(r ->> 'event_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'event_date')::date else event_date end,
    start_time = left(coalesce(r ->> 'start_time', start_time), 10), end_time = left(coalesce(r ->> 'end_time', end_time), 10),
    guests = case when coalesce(r ->> 'guests', '') ~ '^\d{1,5}$' then (r ->> 'guests')::int else guests end,
    location = left(coalesce(r ->> 'location', location), 240),
    estimate = case when coalesce(r ->> 'estimate', '') ~ '^\d{1,8}(\.\d+)?$' then round((r ->> 'estimate')::numeric, 2) else estimate end,
    summary = case when jsonb_typeof(r -> 'summary') = 'array' then r -> 'summary' else summary end,
    beo = case when jsonb_typeof(r -> 'beo') = 'object' then r -> 'beo' else beo end,
    answers = case when jsonb_typeof(r -> 'answers') = 'object' then r -> 'answers' else answers end,
    guest_notes = left(coalesce(r ->> 'guest_notes', guest_notes), 4000)
  where id = q.id;
  insert into public.inquiry_messages (inquiry_id, kind, subject)
    values (q.id, 'event', case when again then 'Guest updated the questionnaire' else 'Guest completed the questionnaire' end);
  select * into q from public.catering_inquiries where id = q.id;
  return jsonb_build_object('id', q.id, 'name', q.name, 'email', q.email, 'phone', q.phone, 'event_name', q.event_name,
    'event_date', q.event_date, 'guests', q.guests, 'location', q.location, 'estimate', q.estimate, 'again', again);
end $$;
revoke all on function public.submit_plan(text, text, jsonb) from public;
grant execute on function public.submit_plan(text, text, jsonb) to anon, authenticated;

-- A guest replied by email (from the email service, through the worker). p_ref is the inquiry id from the
-- reply address; if it's missing, the reply is matched to the guest's most recent inquiry by their address.
create or replace function public.inbound_message(p_key text, p_ref text, p_from text, p_to text, p_subject text, p_body text, p_email_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.catering_inquiries; addr text := lower(coalesce(substring(p_from from '<([^>]+)>'), trim(p_from), ''));
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  if coalesce(p_email_id, '') <> '' and exists (select 1 from public.inquiry_messages where email_id = p_email_id) then
    return jsonb_build_object('duplicate', true);
  end if;
  if coalesce(p_ref, '') ~ '^[a-f0-9]{32}$' then
    select * into q from public.catering_inquiries where replace(id::text, '-', '') = p_ref;
  end if;
  if q.id is null and addr <> '' then
    select * into q from public.catering_inquiries where lower(email) = addr and status <> 'spam' order by created_at desc limit 1;
  end if;
  if q.id is null then return jsonb_build_object('error', 'no_match'); end if;
  insert into public.inquiry_messages (inquiry_id, kind, from_addr, to_addr, subject, body, mail_status, email_id)
    values (q.id, 'in', left(coalesce(p_from, ''), 240), left(coalesce(p_to, ''), 240), left(coalesce(p_subject, ''), 300),
            left(coalesce(p_body, ''), 20000), 'received', left(coalesce(p_email_id, ''), 120));
  return jsonb_build_object('id', q.id, 'name', q.name, 'email', q.email, 'event_name', q.event_name, 'event_date', q.event_date);
end $$;
revoke all on function public.inbound_message(text, text, text, text, text, text, text) from public;
grant execute on function public.inbound_message(text, text, text, text, text, text, text) to anon, authenticated;

-- Record staff changes in History (if History is set up).
do $$
begin
  if to_regprocedure('public.log_activity()') is not null then
    drop trigger if exists log_activity on public.catering_inquiries;
    create trigger log_activity after update or delete on public.catering_inquiries for each row
      when (auth.uid() is not null) execute function public.log_activity();   -- staff changes, not the guest's confirm click
  end if;
end $$;
