-- Eden staff site: Pre-shift (starting with tonight's reservations from OpenTable).
-- Run AFTER supabase/inquiries.sql, supabase/team.sql and supabase/business-email.sql.
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- How it works: when OpenTable's email arrives in the Owner's mailbox (rich@edencny.com), the staff site's worker
-- reads it (every 20 minutes, or straight away when a manager opens Pre-shift), takes out tonight's reservations
-- and numbers, and saves them here for that day. Everyone on the team can read today's pre-shift; the Owner and
-- managers can add to it. Each day's pre-shift is cleared after midnight.
-- Guests' phone numbers and email addresses are removed before anything is saved.

create table if not exists public.preshift_days (
  service_date     date primary key,
  source_email_id  text not null default '',
  source_subject   text not null default '',
  source_received  timestamptz,
  source_forwarded boolean not null default false,
  reservations     jsonb not null default '{}'::jsonb,   -- { stats: [...], list: [...], sections: [...], text }
  notes            jsonb not null default '{}'::jsonb,   -- what managers add (later sections)
  updated_at       timestamptz not null default now()
);
alter table public.preshift_days enable row level security;
revoke all on public.preshift_days from anon;
grant select, insert, update, delete on public.preshift_days to authenticated;

drop policy if exists "team reads pre-shift" on public.preshift_days;
create policy "team reads pre-shift" on public.preshift_days for select to authenticated using (public.is_team());
drop policy if exists "owner and managers write pre-shift" on public.preshift_days;
create policy "owner and managers write pre-shift" on public.preshift_days for all to authenticated
  using (public.access_level() in ('owner', 'manager')) with check (public.access_level() in ('owner', 'manager'));

-- For the worker only (it proves itself with the private inquiry key, the same one the catering form uses):
-- the locked Google permission for the mailbox OpenTable writes to.
create or replace function public.mail_token_server(p_key text, p_address text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.mail_accounts;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  select * into m from public.mail_accounts where address = lower(trim(p_address));
  if not found then return jsonb_build_object('error', 'not_connected'); end if;
  return jsonb_build_object('id', m.id, 'address', m.address, 'token', m.token_enc, 'status', m.status);
end $$;

-- save a day's reservations (and clear out past days)
create or replace function public.preshift_save_server(p_key text, p_date date, p_row jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  delete from public.preshift_days where service_date < (now() at time zone 'America/New_York')::date;
  insert into public.preshift_days (service_date, source_email_id, source_subject, source_received, source_forwarded, reservations, updated_at)
  values (p_date, coalesce(p_row ->> 'email_id', ''), coalesce(p_row ->> 'subject', ''), (p_row ->> 'received')::timestamptz,
          coalesce((p_row ->> 'forwarded')::boolean, false), coalesce(p_row -> 'reservations', '{}'::jsonb), now())
  on conflict (service_date) do update set source_email_id = excluded.source_email_id, source_subject = excluded.source_subject,
    source_received = excluded.source_received, source_forwarded = excluded.source_forwarded, reservations = excluded.reservations, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- which email today's pre-shift came from (so the worker doesn't read the same one twice), and clear past days
create or replace function public.preshift_status_server(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/New_York')::date; r public.preshift_days;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  delete from public.preshift_days where service_date < today;
  select * into r from public.preshift_days where service_date = today;
  return jsonb_build_object('today', today, 'email_id', coalesce(r.source_email_id, ''));
end $$;

revoke all on function public.mail_token_server(text, text), public.preshift_save_server(text, date, jsonb), public.preshift_status_server(text) from public, authenticated;
grant execute on function public.mail_token_server(text, text), public.preshift_save_server(text, date, jsonb), public.preshift_status_server(text) to anon;

-- Pre-shift section 2: menu changes in the last day (from Analytics > History, which records every menu edit).
-- Everyone on the team can see what changed on the menu; History itself stays Owner-only.
create or replace function public.menu_changes(p_hours int default 24) returns jsonb
language sql stable security definer set search_path = public as $$
  with l as (
    select * from public.activity_log
    where tbl = 'site_docs' and row_key like 'site/menu/groups/%'
      and at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 168)))
  ), g as (
    select row_key,
      (array_agg(old_row order by at asc))[1] as first_old,
      (array_agg(new_row order by at desc))[1] as last_new,
      (array_agg(action order by at asc))[1] as first_action,
      (array_agg(action order by at desc))[1] as last_action,
      (array_agg(who order by at desc))[1] as who,
      max(at) as at
    from l group by row_key
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', row_key, 'before', first_old -> 'data', 'after', last_new -> 'data',
           'first', first_action, 'last', last_action, 'who', who, 'at', at) order by at desc), '[]'::jsonb)
  from g where public.is_team()
$$;
revoke all on function public.menu_changes(int) from public, anon;
grant execute on function public.menu_changes(int) to authenticated;
