-- Eden staff site: Promotional emails (Office > Promotional emails).
-- Run AFTER supabase/access-and-timeoff.sql and supabase/inquiries.sql (it uses the private inquiry key).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- The Owner and managers keep a guest list (uploaded from a spreadsheet, or people who join on edencny.com),
-- write and design emails, send a test to themselves, send now or schedule, and see who opened and clicked.
-- Emails go out through Resend from the staff site's worker. Everyone on the list can unsubscribe with one click;
-- unsubscribed, bounced and complained addresses are never emailed again (an upload doesn't add them back).
-- Guests' email addresses are only visible to the Owner and managers.

-- 1. The guest list
create table if not exists public.promo_contacts (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  name             text not null default '',
  source           text not null default 'upload' check (source in ('upload', 'website', 'manual')),
  status           text not null default 'subscribed' check (status in ('subscribed', 'unsubscribed', 'bounced', 'complained')),
  token            uuid not null default gen_random_uuid() unique,   -- for the unsubscribe link
  added_by         text not null default '',
  ip_key           text not null default '',                          -- website sign-ups: a one-way code, to slow down bots
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unsubscribed_at  timestamptz
);
create index if not exists promo_contacts_status on public.promo_contacts (status);

create or replace function public.promo_contacts_tidy() returns trigger language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  new.name := left(trim(coalesce(new.name, '')), 120);
  new.updated_at := now();
  if new.status <> 'subscribed' and new.unsubscribed_at is null then new.unsubscribed_at := now(); end if;
  if new.status = 'subscribed' then new.unsubscribed_at := null; end if;
  return new;
end $$;
drop trigger if exists promo_contacts_tidy on public.promo_contacts;
create trigger promo_contacts_tidy before insert or update on public.promo_contacts for each row execute function public.promo_contacts_tidy();

-- 2. The emails
create table if not exists public.promo_campaigns (
  id            uuid primary key default gen_random_uuid(),
  subject       text not null default '',
  preheader     text not null default '',
  design        jsonb not null default '{}'::jsonb,   -- heading, photo, message, button (what the editor shows)
  html          text not null default '',              -- the finished email ({{unsubscribe_url}} filled in per guest)
  text_body     text not null default '',
  status        text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  scheduled_at  timestamptz,
  started_at    timestamptz,
  sent_at       timestamptz,
  heartbeat     timestamptz,
  recipients    integer not null default 0,
  error         text not null default '',
  created_by    text not null default '',
  updated_by    text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists promo_campaigns_due on public.promo_campaigns (status, scheduled_at);

-- 3. Who each email went to, and what happened (Resend tells us: delivered, opened, clicked, bounced, complained)
create table if not exists public.promo_sends (
  campaign_id   uuid not null references public.promo_campaigns (id) on delete cascade,
  contact_id    uuid references public.promo_contacts (id) on delete set null,
  email         text not null,
  resend_id     text unique,
  status        text not null default 'sent' check (status in ('sent', 'failed', 'delivered', 'bounced', 'complained')),
  error         text not null default '',
  sent_at       timestamptz not null default now(),
  delivered_at  timestamptz,
  opened_at     timestamptz,
  open_count    integer not null default 0,
  clicked_at    timestamptz,
  click_count   integer not null default 0,
  primary key (campaign_id, email)
);
create index if not exists promo_sends_contact on public.promo_sends (contact_id);

-- who changed an email last
create or replace function public.promo_who() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(s.name, '') from public.staff s where s.user_id = auth.uid() limit 1),
                  (select nullif(e.name, '') from public.employees e where e.email <> '' and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1),
                  nullif(auth.jwt() ->> 'email', ''), '')
$$;
revoke all on function public.promo_who() from public, anon;
grant execute on function public.promo_who() to authenticated;

create or replace function public.promo_campaigns_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := public.promo_who();
    if tg_op = 'INSERT' then new.created_by := new.updated_by; end if;
    if tg_op = 'UPDATE' then
      -- what's sent stays as it was sent; sending is the worker's job
      if old.status in ('sending', 'sent') then
        new.subject := old.subject; new.preheader := old.preheader; new.design := old.design; new.html := old.html; new.text_body := old.text_body;
        new.status := old.status; new.scheduled_at := old.scheduled_at;
      end if;
      if new.status in ('sending', 'sent') and old.status not in ('sending', 'sent') then new.status := old.status; end if;
      new.started_at := old.started_at; new.sent_at := old.sent_at; new.recipients := old.recipients; new.heartbeat := old.heartbeat;
    end if;
    if tg_op = 'INSERT' and new.status not in ('draft', 'scheduled') then new.status := 'draft'; end if;
  end if;
  return new;
end $$;
revoke all on function public.promo_campaigns_touch() from public, anon, authenticated;
drop trigger if exists promo_campaigns_touch on public.promo_campaigns;
create trigger promo_campaigns_touch before insert or update on public.promo_campaigns for each row execute function public.promo_campaigns_touch();

-- 4. Only the Owner and managers
alter table public.promo_contacts enable row level security;
alter table public.promo_campaigns enable row level security;
alter table public.promo_sends enable row level security;
revoke all on public.promo_contacts, public.promo_campaigns, public.promo_sends from anon;
grant select, insert, update, delete on public.promo_contacts, public.promo_campaigns to authenticated;
grant select on public.promo_sends to authenticated;

drop policy if exists "managers: guest list" on public.promo_contacts;
create policy "managers: guest list" on public.promo_contacts for all to authenticated
  using (coalesce(public.can_schedule(), false)) with check (coalesce(public.can_schedule(), false));
drop policy if exists "managers: read emails" on public.promo_campaigns;
create policy "managers: read emails" on public.promo_campaigns for select to authenticated using (coalesce(public.can_schedule(), false));
drop policy if exists "managers: write emails" on public.promo_campaigns;
create policy "managers: write emails" on public.promo_campaigns for insert to authenticated with check (coalesce(public.can_schedule(), false));
drop policy if exists "managers: change emails" on public.promo_campaigns;
create policy "managers: change emails" on public.promo_campaigns for update to authenticated
  using (coalesce(public.can_schedule(), false)) with check (coalesce(public.can_schedule(), false));
drop policy if exists "managers: delete unsent emails" on public.promo_campaigns;
create policy "managers: delete unsent emails" on public.promo_campaigns for delete to authenticated
  using (coalesce(public.can_schedule(), false) and status in ('draft', 'scheduled', 'failed'));
drop policy if exists "managers: results" on public.promo_sends;
create policy "managers: results" on public.promo_sends for select to authenticated using (coalesce(public.can_schedule(), false));

-- 5. Upload a guest list: [{email, name}]. Addresses already on the list keep their status (an upload never
--    resubscribes someone who unsubscribed); blank names are filled in.
create or replace function public.promo_import(p_rows jsonb, p_source text default 'upload') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; em text; nm text; added int := 0; had int := 0; bad int := 0; off int := 0; who text := public.promo_who(); cur public.promo_contacts;
begin
  if not coalesce(public.can_schedule(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then return jsonb_build_object('error', 'bad'); end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    em := lower(trim(coalesce(r ->> 'email', '')));
    nm := left(trim(coalesce(r ->> 'name', '')), 120);
    if em !~ '^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$' then bad := bad + 1; continue; end if;
    select * into cur from public.promo_contacts where email = em;
    if found then
      had := had + 1; if cur.status <> 'subscribed' then off := off + 1; end if;
      if cur.name = '' and nm <> '' then update public.promo_contacts set name = nm where id = cur.id; end if;
    else
      insert into public.promo_contacts (email, name, source, added_by) values (em, nm, case when p_source in ('upload', 'manual') then p_source else 'upload' end, who);
      added := added + 1;
    end if;
  end loop;
  return jsonb_build_object('added', added, 'already', had, 'invalid', bad, 'unsubscribed', off);
end $$;
revoke all on function public.promo_import(jsonb, text) from public, anon;
grant execute on function public.promo_import(jsonb, text) to authenticated;

-- 6. Results for each email (and the list size), for the Emails list
create or replace function public.promo_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not coalesce(public.can_schedule(), false) then jsonb_build_object('error', 'not_allowed') else jsonb_build_object(
    'subscribed', (select count(*) from public.promo_contacts where status = 'subscribed'),
    'total', (select count(*) from public.promo_contacts),
    'stats', coalesce((select jsonb_object_agg(x.campaign_id, x.st) from (
      select s.campaign_id, jsonb_build_object(
        'sent', count(*) filter (where s.status <> 'failed'),
        'failed', count(*) filter (where s.status = 'failed'),
        'delivered', count(*) filter (where s.delivered_at is not null or s.status = 'delivered'),
        'opened', count(*) filter (where s.opened_at is not null),
        'clicked', count(*) filter (where s.clicked_at is not null),
        'bounced', count(*) filter (where s.status = 'bounced'),
        'complained', count(*) filter (where s.status = 'complained'),
        'unsubscribed', count(*) filter (where c.status = 'unsubscribed' and c.unsubscribed_at >= s.sent_at)) as st
      from public.promo_sends s left join public.promo_contacts c on c.id = s.contact_id
      group by s.campaign_id) x), '{}'::jsonb)) end
$$;
revoke all on function public.promo_overview() from public, anon;
grant execute on function public.promo_overview() to authenticated;

/* ---------- for the staff site's worker only (it proves itself with the private inquiry key) ---------- */

-- someone joins on edencny.com (a returning guest who had unsubscribed is welcomed back: they asked to join)
create or replace function public.promo_subscribe_server(p_key text, p_email text, p_name text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p_email, ''))); cur public.promo_contacts;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  if em !~ '^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$' or length(em) > 200 then return jsonb_build_object('error', 'email'); end if;
  if coalesce(p_ip, '') <> '' and (select count(*) from public.promo_contacts where ip_key = p_ip and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('error', 'busy');
  end if;
  select * into cur from public.promo_contacts where email = em;
  if found then
    if cur.status = 'subscribed' then return jsonb_build_object('ok', true, 'already', true); end if;
    if cur.status in ('bounced') then return jsonb_build_object('ok', true, 'already', true); end if;
    update public.promo_contacts set status = 'subscribed', name = coalesce(nullif(name, ''), left(trim(coalesce(p_name, '')), 120)) where id = cur.id;
    return jsonb_build_object('ok', true, 'back', true);
  end if;
  insert into public.promo_contacts (email, name, source, ip_key, added_by) values (em, left(trim(coalesce(p_name, '')), 120), 'website', coalesce(p_ip, ''), 'Website sign-up');
  return jsonb_build_object('ok', true);
end $$;

-- the unsubscribe link: look up (to show which address) and unsubscribe
create or replace function public.promo_unsub_server(p_key text, p_token text, p_do boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur public.promo_contacts; t uuid;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  begin t := p_token::uuid; exception when others then return jsonb_build_object('error', 'token'); end;
  select * into cur from public.promo_contacts where token = t;
  if not found then return jsonb_build_object('error', 'token'); end if;
  if p_do and cur.status = 'subscribed' then update public.promo_contacts set status = 'unsubscribed' where id = cur.id; end if;
  return jsonb_build_object('ok', true, 'email', cur.email, 'status', case when p_do and cur.status = 'subscribed' then 'unsubscribed' else cur.status end);
end $$;

-- the next email that's due (scheduled for now or earlier, or a send that stopped part-way)
create or replace function public.promo_claim_server(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.promo_campaigns;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  select * into c from public.promo_campaigns
   where (status = 'scheduled' and scheduled_at <= now()) or (status = 'sending' and coalesce(heartbeat, started_at) < now() - interval '4 minutes')
   order by scheduled_at nulls first limit 1 for update skip locked;
  if not found then return jsonb_build_object('none', true); end if;
  update public.promo_campaigns set status = 'sending', started_at = coalesce(started_at, now()), heartbeat = now() where id = c.id;
  return jsonb_build_object('id', c.id, 'subject', c.subject, 'preheader', c.preheader, 'html', c.html, 'text', c.text_body);
end $$;

-- the next guests to send it to (subscribed, and not sent this email yet)
create or replace function public.promo_batch_server(p_key text, p_campaign uuid, p_limit int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  update public.promo_campaigns set heartbeat = now() where id = p_campaign;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'email', c.email, 'name', c.name, 'token', c.token) order by c.created_at, c.id)
    from (select * from public.promo_contacts c where c.status = 'subscribed'
            and not exists (select 1 from public.promo_sends s where s.campaign_id = p_campaign and s.email = c.email)
          order by c.created_at, c.id limit greatest(1, least(coalesce(p_limit, 100), 100))) c), '[]'::jsonb);
end $$;

-- what happened to each guest in a batch: [{contact_id, email, resend_id, error}]
create or replace function public.promo_record_server(p_key text, p_campaign uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  insert into public.promo_sends (campaign_id, contact_id, email, resend_id, status, error)
  select p_campaign, nullif(x ->> 'contact_id', '')::uuid, lower(x ->> 'email'), nullif(x ->> 'resend_id', ''),
         case when coalesce(x ->> 'resend_id', '') = '' then 'failed' else 'sent' end, left(coalesce(x ->> 'error', ''), 300)
  from jsonb_array_elements(p_rows) x
  on conflict (campaign_id, email) do nothing;
  update public.promo_campaigns set heartbeat = now() where id = p_campaign;
  return jsonb_build_object('ok', true);
end $$;

-- done (or stopped with an error)
create or replace function public.promo_finish_server(p_key text, p_campaign uuid, p_error text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  update public.promo_campaigns set
    status = case when coalesce(p_error, '') = '' then 'sent' else 'failed' end,
    error = left(coalesce(p_error, ''), 500), sent_at = case when coalesce(p_error, '') = '' then now() else sent_at end,
    recipients = (select count(*) from public.promo_sends where campaign_id = p_campaign and status <> 'failed'), heartbeat = now()
  where id = p_campaign;
  return jsonb_build_object('ok', true);
end $$;

-- Resend tells us what happened: email.delivered / opened / clicked / bounced / complained
create or replace function public.promo_event_server(p_key text, p_resend_id text, p_type text, p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.promo_sends; at timestamptz := coalesce(p_at, now());
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  select * into s from public.promo_sends where resend_id = p_resend_id;
  if not found then return jsonb_build_object('ok', true, 'matched', false); end if;
  if p_type = 'email.delivered' then
    update public.promo_sends set delivered_at = coalesce(delivered_at, at), status = case when status = 'sent' then 'delivered' else status end where resend_id = p_resend_id;
  elsif p_type = 'email.opened' then
    update public.promo_sends set opened_at = coalesce(opened_at, at), open_count = open_count + 1 where resend_id = p_resend_id;
  elsif p_type = 'email.clicked' then
    update public.promo_sends set clicked_at = coalesce(clicked_at, at), click_count = click_count + 1, opened_at = coalesce(opened_at, at) where resend_id = p_resend_id;
  elsif p_type = 'email.bounced' then
    update public.promo_sends set status = 'bounced' where resend_id = p_resend_id;
    update public.promo_contacts set status = 'bounced' where id = s.contact_id and status = 'subscribed';
  elsif p_type = 'email.complained' then
    update public.promo_sends set status = 'complained' where resend_id = p_resend_id;
    update public.promo_contacts set status = 'complained' where id = s.contact_id and status in ('subscribed', 'unsubscribed');
  end if;
  return jsonb_build_object('ok', true, 'matched', true);
end $$;

revoke all on function public.promo_subscribe_server(text, text, text, text), public.promo_unsub_server(text, text, boolean),
  public.promo_claim_server(text), public.promo_batch_server(text, uuid, int), public.promo_record_server(text, uuid, jsonb),
  public.promo_finish_server(text, uuid, text), public.promo_event_server(text, text, text, timestamptz) from public, authenticated;
grant execute on function public.promo_subscribe_server(text, text, text, text), public.promo_unsub_server(text, text, boolean),
  public.promo_claim_server(text), public.promo_batch_server(text, uuid, int), public.promo_record_server(text, uuid, jsonb),
  public.promo_finish_server(text, uuid, text), public.promo_event_server(text, text, text, timestamptz) to anon;

-- 7. Photos for emails: a public folder (email programs have to be able to load them without signing in)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('promo-images', 'promo-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
drop policy if exists "managers add email photos" on storage.objects;
create policy "managers add email photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'promo-images' and coalesce(public.can_schedule(), false));
drop policy if exists "managers remove email photos" on storage.objects;
create policy "managers remove email photos" on storage.objects for delete to authenticated
  using (bucket_id = 'promo-images' and coalesce(public.can_schedule(), false));
