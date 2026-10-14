-- Eden staff site: the Hub (the touch screen in the restaurant, at edencny-staff.com/hub/).
-- Run AFTER supabase/schema.sql, access-and-timeoff.sql, notes.sql and team.sql (and permissions.sql, if you've run it).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- The Hub signs in with its own login, role 'hub' in the staff table. That login can open the Hub page and nothing
-- else: it is not on the team (no schedule, recipes, prep list, board or anything an employee sees), it can't use the
-- staff site, and it never sees pay, phone numbers or guest spend. The Owner and managers can open the Hub too.
-- To make the Hub's login: run this file, then Authentication > Users > Add user (hub@edencny.com), then the insert at the bottom.
-- Using a different email for the Hub? Change hub@edencny.com in section 3 and at the bottom.
-- If you run team.sql or staff-signup.sql again later, run this file again afterwards.

-- 1. 'hub' is a staff role
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('owner', 'manager', 'kitchen', 'foh', 'hub'));

-- 2. ...but not a team member, an employee or a to-do user
create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() <> 'hub', false) or public.my_employee_id() is not null
$$;
create or replace function public.access_level() returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.staff_role() = 'owner' then 'owner'
    when public.staff_role() = 'manager' then 'manager'
    when exists (select 1 from public.employees
                 where active and access = 'manager' and email <> ''
                   and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) then 'manager'
    when coalesce(public.staff_role() <> 'hub', false) or public.my_employee_id() is not null then 'employee'
    else null end
$$;
create or replace function public.can_todo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public.staff_role() is not null and public.staff_role() <> 'hub') or public.can_schedule(), false)
$$;

-- 3. The Hub's login isn't an employee, so let it be created. Only emails on the employee list can get an account
--    (team.sql / staff-signup.sql); this adds a short list of extra logins the Owner allows, starting with the Hub.
create table if not exists public.signup_allow (
  email text primary key check (email = lower(trim(email)) and email <> ''),
  note  text not null default '',
  created_at timestamptz not null default now()
);
alter table public.signup_allow enable row level security;
revoke all on public.signup_allow from anon;
drop policy if exists "owner manages extra logins" on public.signup_allow;
create policy "owner manages extra logins" on public.signup_allow for all to authenticated
  using (coalesce(public.staff_role() = 'owner', false)) with check (coalesce(public.staff_role() = 'owner', false));
insert into public.signup_allow (email, note) values ('hub@edencny.com', 'The Hub (touch screen)') on conflict (email) do nothing;

create or replace function public.only_team_signups() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.employees where email <> '' and lower(trim(email)) = lower(trim(new.email)))
     or exists (select 1 from public.signup_allow where email = lower(trim(new.email))) then
    return new;
  end if;
  raise exception 'This email is not on the Eden staff list';
end $$;

-- 4. who may open the Hub page: the Hub login, the Owner and managers
create or replace function public.hub_ok() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', coalesce(public.staff_role() in ('hub', 'owner', 'manager'), false) or coalesce(public.can_schedule(), false),
    'hub', coalesce(public.staff_role() = 'hub', false))
$$;
revoke all on function public.hub_ok() from public, anon;
grant execute on function public.hub_ok() to authenticated;

-- 5. What the Hub shows, in one read-only call: today's pre-shift (no guest spend), pre-shift notes, menu changes,
--    the kitchen prep list (not the bar list), today's published schedule and the calendar for the next two weeks. Only the Hub login, the Owner
--    and managers get anything back. Each part is skipped (null) until its own SQL file has been run.
create or replace function public.hub_board() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  out jsonb := jsonb_build_object('today', today);
  r record; res jsonb; sh jsonb;
begin
  if not (coalesce(public.staff_role() in ('hub', 'owner', 'manager'), false) or coalesce(public.can_schedule(), false)) then
    return jsonb_build_object('error', 'not_allowed');
  end if;

  -- pre-shift: tonight's reservations, without guest spend or the raw email
  if to_regclass('public.preshift_days') is not null then
    select * into r from public.preshift_days where service_date = today;
    if found then
      res := coalesce(r.reservations, '{}'::jsonb) - 'text' - 'sections';
      if jsonb_typeof(res -> 'list') = 'array' then
        res := jsonb_set(res, '{list}', (select coalesce(jsonb_agg(case when jsonb_typeof(x -> 'guest') = 'object' then jsonb_set(x, '{guest}', (x -> 'guest') - 'spend') else x end), '[]'::jsonb)
                                         from jsonb_array_elements(res -> 'list') x));
      end if;
      out := out || jsonb_build_object('preshift', jsonb_build_object('reservations', res, 'received', r.source_received, 'updated_at', r.updated_at));
    end if;
  end if;

  -- pre-shift notes for today (words only)
  if to_regclass('public.preshift_notes') is not null then
    out := out || jsonb_build_object('notes', (select coalesce(jsonb_agg(jsonb_build_object('body', n.body, 'author', n.author, 'at', n.created_at) order by n.created_at), '[]'::jsonb)
                                               from public.preshift_notes n where n.service_date = today));
  end if;

  -- menu changes in the last 24 hours (which sections changed)
  if to_regclass('public.activity_log') is not null then
    out := out || jsonb_build_object('menu', (select coalesce(jsonb_agg(jsonb_build_object('title', t.title, 'at', t.at) order by t.at desc), '[]'::jsonb) from (
      select coalesce((array_agg(l.new_row -> 'data' ->> 'title' order by l.at desc))[1], (array_agg(l.old_row -> 'data' ->> 'title' order by l.at desc))[1], 'A menu section') as title, max(l.at) as at
      from public.activity_log l
      where l.tbl = 'site_docs' and l.row_key like 'site/menu/groups/%' and l.at > now() - interval '24 hours'
      group by l.row_key) t));
  end if;

  -- the kitchen prep list (bar sections' ids start with b-)
  if to_regclass('public.prep_lists') is not null then
    select * into r from public.prep_lists where id = 'eden';
    if found then
      out := out || jsonb_build_object('prep', jsonb_build_object(
        'for_date', r.for_date, 'reset_at', r.reset_at, 'updated_at', r.updated_at,
        'entries', coalesce((select jsonb_object_agg(k, v) from jsonb_each(r.entries) x(k, v) where split_part(k, ':', 2) not like 'b-%'), '{}'::jsonb),
        'removed', coalesce((select jsonb_object_agg(k, v) from jsonb_each(r.removed) x(k, v) where split_part(k, ':', 2) not like 'b-%'), '{}'::jsonb),
        'extra', coalesce((select jsonb_object_agg(k, v) from jsonb_each(r.extra) x(k, v) where k not like 'b-%'), '{}'::jsonb)));
    end if;
  end if;

  -- today's published shifts (names, positions and times only; no phone numbers). Null until schedule.sql has been run.
  if to_regclass('public.schedule_weeks') is not null then
    select w.published into sh from public.schedule_weeks w
      where w.week_start = today - extract(dow from today)::int and w.status = 'published';
    if found then
      out := out || jsonb_build_object('shifts_posted', true, 'shifts', (select coalesce(jsonb_agg(jsonb_build_object(
          'name', coalesce(nullif(trim(e.name), ''), 'Team member'), 'position', coalesce(e.position, ''),
          'start', s ->> 'start', 'end', s ->> 'end', 'role', coalesce(s ->> 'role', ''), 'note', coalesce(s ->> 'note', ''))
          order by s ->> 'start', e.name), '[]'::jsonb)
        from jsonb_array_elements(coalesce(sh, '[]'::jsonb)) s
        left join public.employees e on e.id::text = s ->> 'emp'
        where (s ->> 'day')::int = extract(dow from today)::int));
    else
      out := out || jsonb_build_object('shifts_posted', false, 'shifts', '[]'::jsonb);
    end if;
  end if;

  -- the calendar: today and the next 13 days (no notes)
  if to_regclass('public.events') is not null then
    out := out || jsonb_build_object('events', (select coalesce(jsonb_agg(jsonb_build_object('title', e.title, 'type', e.type, 'date', e.date, 'all_day', e.all_day,
        'start', e.start, 'end', e."end", 'room', e.room, 'guests', e.guests) order by e.date, e.start), '[]'::jsonb)
      from public.events e where e.date between today and today + 13));
  end if;
  return out;
end $$;
revoke all on function public.hub_board() from public, anon;
grant execute on function public.hub_board() to authenticated;

-- 6. Make the Hub's login (do this once, after adding the user in Authentication > Users):
--    change the email below to the one you used, then run just these three lines.
-- insert into public.staff (user_id, name, role)
-- select id, 'Hub', 'hub' from auth.users where email = 'hub@edencny.com'
-- on conflict (user_id) do update set role = 'hub', name = 'Hub';
