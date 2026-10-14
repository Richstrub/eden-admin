-- Eden staff site: the Hub (the touch screen in the restaurant, at edencny-staff.com/hub/).
-- Run AFTER supabase/schema.sql, access-and-timeoff.sql, notes.sql and team.sql (and permissions.sql, if you've run it).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- The Hub signs in with its own login, role 'hub' in the staff table. That login can open the Hub page and nothing
-- else: it is not on the team (no schedule, recipes, prep list, board or anything an employee sees), it can't use the
-- staff site, and it never sees pay, phone numbers or guest spend. The Owner and managers can open the Hub too.
-- To make the Hub's login: run this file, then Authentication > Users > Add user (hub@edencny.com), then the insert at the bottom.
-- Using a different email for the Hub? Change hub@edencny.com in section 3 and at the bottom.
-- Also sets up the order list and the shift checklists (sections 8 and 9), and lets the Hub work the kitchen prep list (7).
-- If you run team.sql, staff-signup.sql, prep-list.sql or permissions.sql again later, run this file again afterwards.

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
--    the kitchen prep list (not the bar list), today's and this week's published schedule and the calendar for the next two weeks. Only the Hub login, the Owner
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
      -- the whole week (Sunday to Saturday), for the week view
      out := out || jsonb_build_object('week_start', today - extract(dow from today)::int, 'week_shifts', (select coalesce(jsonb_agg(jsonb_build_object(
          'day', (s ->> 'day')::int, 'name', coalesce(nullif(trim(e.name), ''), 'Team member'), 'position', coalesce(e.position, ''),
          'start', s ->> 'start', 'end', s ->> 'end', 'role', coalesce(s ->> 'role', ''))
          order by (s ->> 'day')::int, s ->> 'start', e.name), '[]'::jsonb)
        from jsonb_array_elements(coalesce(sh, '[]'::jsonb)) s
        left join public.employees e on e.id::text = s ->> 'emp'));
      out := out || jsonb_build_object('shifts_posted', true, 'shifts', (select coalesce(jsonb_agg(jsonb_build_object(
          'name', coalesce(nullif(trim(e.name), ''), 'Team member'), 'position', coalesce(e.position, ''),
          'start', s ->> 'start', 'end', s ->> 'end', 'role', coalesce(s ->> 'role', ''), 'note', coalesce(s ->> 'note', ''))
          order by s ->> 'start', e.name), '[]'::jsonb)
        from jsonb_array_elements(coalesce(sh, '[]'::jsonb)) s
        left join public.employees e on e.id::text = s ->> 'emp'
        where (s ->> 'day')::int = extract(dow from today)::int));
    else
      out := out || jsonb_build_object('shifts_posted', false, 'shifts', '[]'::jsonb,
        'week_start', today - extract(dow from today)::int, 'week_shifts', '[]'::jsonb);
    end if;
  end if;

  -- open orders and today's checklist progress, for the Hub's menu
  if to_regclass('public.order_items') is not null then
    out := out || jsonb_build_object('orders_open', (select count(*) from public.order_items where received_at is null),
      'orders_stamp', (select md5(coalesce(string_agg(id::text || coalesce(received_at::text, ''), ',' order by id), '')) from public.order_items where received_at is null or received_at > now() - interval '3 days'));
  end if;
  if to_regclass('public.checklists') is not null then
    out := out || jsonb_build_object('checklists', public.checklist_get(null) -> 'lists');
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

-- 5b. A tiny fingerprint of the board. The Hub checks it every few seconds and downloads the board only when it changes,
--     so updates show up almost immediately without using much data.
create or replace function public.hub_stamp() returns text
language sql stable security definer set search_path = public as $$
  select md5(public.hub_board()::text)
$$;
revoke all on function public.hub_stamp() from public, anon;
grant execute on function public.hub_stamp() to authenticated;

-- 7. The Hub can work the kitchen prep list like a cook: tick lines, fill in On hand / Prep / initials, and add items.
--    It can't take lines off (Owner only), reset the list (Owner and managers) or see the bar list.
--    These are the same functions as in prep-list.sql and permissions.sql, with the Hub added (kept in step with them).
do $hubprep$ begin
  if to_regprocedure('public.can_prep()') is not null then
    execute $fn$
create or replace function public.can_prep() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.staff_role() in ('owner', 'manager', 'hub'), false) or coalesce(public.can_schedule(), false) then return true; end if;   -- 'hub': the Hub screen (supabase/hub.sql)
  if to_regprocedure('public.section_ok(text)') is not null then   -- Team > Permissions decides, once permissions.sql is run
    return coalesce(public.is_team(), false) and coalesce(public.section_ok('prep'), false);
  end if;
  return coalesce(public.staff_role() = 'kitchen', false) or coalesce(public.is_cook(), false);
end $$;
    $fn$;
  end if;
  if to_regprocedure('public.section_ok(text)') is not null then
    execute $fn$
create or replace function public.section_ok(p_section text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parent text := split_part(p_section, '.', 1);
begin
  if coalesce(public.access_level() in ('owner', 'manager'), false) or coalesce(public.staff_role() in ('owner', 'manager'), false) then return true; end if;
  if coalesce(public.staff_role() = 'hub', false) then return p_section in ('prep', 'prep.edit', 'prep.kitchen'); end if;   -- the Hub screen: the kitchen prep list only
  if p_section <> parent and not public.section_ok(parent) then return false; end if;
  return coalesce(
    (select p.allowed from public.section_people p where p.employee_id = public.my_employee_id() and p.section = p_section),
    (select r.allowed from public.section_rules r where r.level = public.my_level() and r.section = p_section),
    case p_section when 'prep' then public.my_level() in ('cook', 'bartender')
                   when 'prep.kitchen' then public.my_level() <> 'bartender'
                   when 'prep.bar' then public.my_level() <> 'cook'
                   else true end);
end $$;
    $fn$;
  end if;
end $hubprep$;

-- 8. The order list: anyone on the staff (and the Hub) can add what needs ordering. Only the Hub, the Owner and
--    managers can mark an order received, and only the Owner and managers can delete one. Read and changed only
--    through the functions below.
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  item text not null check (length(trim(item)) between 1 and 200),
  qty text not null default '' check (length(qty) <= 60),
  note text not null default '' check (length(note) <= 300),
  added_by text not null default '',
  added_at timestamptz not null default now(),
  received_at timestamptz,
  received_by text not null default ''
);
alter table public.order_items enable row level security;
revoke all on public.order_items from anon, authenticated;

create or replace function public.hub_me() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(s.name), '') from public.staff s where s.user_id = auth.uid() limit 1),
                  (select nullif(trim(e.name), '') from public.employees e where e.email <> '' and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1),
                  nullif(auth.jwt() ->> 'email', ''), '')
$$;
revoke all on function public.hub_me() from public, anon, authenticated;

create or replace function public.order_can(p_what text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_what
    when 'add' then coalesce(public.staff_role() in ('owner', 'manager', 'hub'), false) or coalesce(public.is_team(), false) or coalesce(public.can_schedule(), false)
    when 'receive' then coalesce(public.staff_role() in ('owner', 'manager', 'hub'), false) or coalesce(public.access_level() in ('owner', 'manager'), false)
    when 'delete' then coalesce(public.staff_role() in ('owner', 'manager'), false) or coalesce(public.access_level() in ('owner', 'manager'), false)
    else false end
$$;
revoke all on function public.order_can(text) from public, anon;
grant execute on function public.order_can(text) to authenticated;

create or replace function public.order_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.order_can('add') then return jsonb_build_object('error', 'not_allowed'); end if;
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(to_jsonb(o) order by o.added_at), '[]'::jsonb) from public.order_items o where o.received_at is null),
    'received', (select coalesce(jsonb_agg(to_jsonb(o) order by o.received_at desc), '[]'::jsonb) from public.order_items o
                 where o.received_at > now() - interval '3 days'),
    'can_receive', public.order_can('receive'), 'can_delete', public.order_can('delete'), 'me', public.hub_me());
end $$;
revoke all on function public.order_list() from public, anon;
grant execute on function public.order_list() to authenticated;

-- p_by: on the Hub (one shared login), the name typed in; everyone else is named from their own login
create or replace function public.order_add(p_item text, p_qty text, p_note text, p_by text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.order_can('add') then return jsonb_build_object('error', 'not_allowed'); end if;
  if length(trim(coalesce(p_item, ''))) = 0 then return jsonb_build_object('error', 'empty'); end if;
  insert into public.order_items (item, qty, note, added_by)
  values (left(trim(p_item), 200), left(trim(coalesce(p_qty, '')), 60), left(trim(coalesce(p_note, '')), 300),
          case when coalesce(public.staff_role() = 'hub', false) and length(trim(coalesce(p_by, ''))) > 0 then left(trim(p_by), 60) else public.hub_me() end);
  return public.order_list();
end $$;
revoke all on function public.order_add(text, text, text, text) from public, anon;
grant execute on function public.order_add(text, text, text, text) to authenticated;

create or replace function public.order_receive(p_id uuid, p_on boolean, p_by text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.order_can('receive') then return jsonb_build_object('error', 'hub_only'); end if;
  update public.order_items set
    received_at = case when p_on then now() else null end,
    received_by = case when not p_on then ''
                       when coalesce(public.staff_role() = 'hub', false) and length(trim(coalesce(p_by, ''))) > 0 then left(trim(p_by), 60)
                       else public.hub_me() end
  where id = p_id;
  return public.order_list();
end $$;
revoke all on function public.order_receive(uuid, boolean, text) from public, anon;
grant execute on function public.order_receive(uuid, boolean, text) to authenticated;

create or replace function public.order_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.order_can('delete') then return jsonb_build_object('error', 'not_allowed'); end if;
  delete from public.order_items where id = p_id;
  return public.order_list();
end $$;
revoke all on function public.order_delete(uuid) from public, anon;
grant execute on function public.order_delete(uuid) to authenticated;

-- 9. Checklists: Front of house opening, first cut and closing, and Back of house closing. Ticked off on the Hub,
--    one fresh copy per service day (a day runs until 4 am, so closing after midnight still counts for that night).
--    The Owner and managers change the items on the staff site (Service > Checklists). Starter items are put in once.
create table if not exists public.checklists (
  id text primary key,
  title text not null,
  sort int not null default 0,
  items jsonb not null default '[]'::jsonb,   -- [{id, text, head}]  head = a heading line
  updated_at timestamptz not null default now()
);
create table if not exists public.checklist_days (
  list_id text not null references public.checklists(id) on delete cascade,
  day date not null,
  done jsonb not null default '{}'::jsonb,     -- item id -> {by, at}
  primary key (list_id, day)
);
alter table public.checklists enable row level security;
alter table public.checklist_days enable row level security;
revoke all on public.checklists, public.checklist_days from anon, authenticated;

create or replace function public.ck_items(p_lines text[]) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', 'i' || n, 'text', regexp_replace(l, '^#\s*', ''), 'head', l like '#%') order by n), '[]'::jsonb)
  from unnest(p_lines) with ordinality as t(l, n)
$$;
insert into public.checklists (id, title, sort, items) values
('foh-open', 'Front of house opening', 1, public.ck_items(array[
  '# Dining room',
  'Lights, music and dimmers set for service',
  'Restrooms clean and stocked (paper, soap, towels); trash emptied',
  'Tables wiped, steady and set: linens, flatware, glassware',
  'Glassware and flatware polished',
  'Entry, windows and front walk clean',
  'Candles set (light at 4:45)',
  '# Host stand',
  'Tonight''s reservations and notes reviewed in OpenTable',
  'Floor plan printed and sections assigned',
  'Menus clean, current and enough copies',
  '# Bar and service stations',
  'Service stations stocked: napkins, silverware, check presenters',
  'Water pitchers filled; ice in bins',
  'Garnishes cut and bar fruit stocked',
  'Wines by the glass open, dated and chilled',
  'POS on and working; cash drawer counted',
  'Pre-shift meeting'])),
('foh-cut', 'Front of house first cut', 2, public.ck_items(array[
  'All your tickets closed and checkout printed',
  'Open tables handed off to the server staying on',
  'Station restocked: napkins, silverware, glassware',
  'Silverware rolled',
  'Glassware polished and back at the bar',
  'Your section''s tables cleaned and reset',
  'Menus wiped',
  'Side work from the schedule done',
  'Checked out with the manager'])),
('foh-close', 'Front of house closing', 3, public.ck_items(array[
  '# Dining room',
  'All tables cleared, wiped and reset for tomorrow',
  'Floors swept under tables and booths',
  'Candles out; holders cleaned',
  'Bus tubs and trays to dish',
  '# Host stand',
  'Reservations closed out; no-shows noted',
  'Menus wiped; host stand restocked',
  '# Bar',
  'Bar top, rails and back bar wiped down',
  'Open wine and mixers capped, dated and refrigerated',
  'Garnishes wrapped and stored; fruit trays cleaned',
  'Speed rails, tins and tools cleaned; bar mats through dish',
  'Ice wells emptied',
  'Beer, wine and liquor restocked to par (low items on the order list)',
  '# Close out',
  'End-of-day reports run; cash counted',
  'Restrooms cleaned and restocked',
  'Trash and recycling out',
  'Music and lights off; doors locked'])),
('boh-close', 'Back of house closing', 4, public.ck_items(array[
  '# Line',
  'Stations broken down',
  'All prep wrapped, labeled, dated and in the walk-in',
  'Surfaces and cutting boards cleaned and sanitized',
  'Flat-top and fryer cleaned (oil filtered when due)',
  'Wood-fire grill cleaned; ash out to the metal bin',
  'Ovens and burners off',
  '# Walk-in and storage',
  'Walk-in and reach-in temperatures logged',
  'Stock rotated (first in, first out); anything past date tossed',
  'Low items added to the order list',
  '# Dish and floors',
  'Dish machine run, drained and screens cleaned',
  'Trash, recycling and compost out',
  'Floors swept and mopped; drains squeegeed',
  '# Before you leave',
  'Prep list ticked; notes left for tomorrow',
  'Gas off and back door locked']))
on conflict (id) do nothing;

create or replace function public.ck_today() returns date
language sql stable as $$ select ((now() at time zone 'America/New_York') - interval '4 hours')::date $$;

create or replace function public.ck_can(p_what text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_what
    when 'tick' then coalesce(public.staff_role() in ('owner', 'manager', 'hub'), false) or coalesce(public.is_team(), false) or coalesce(public.can_schedule(), false)
    when 'edit' then coalesce(public.staff_role() in ('owner', 'manager'), false) or coalesce(public.access_level() in ('owner', 'manager'), false)
    else false end
$$;
revoke all on function public.ck_can(text) from public, anon;
grant execute on function public.ck_can(text) to authenticated;

-- one list with today's ticks; with p_list null, every list with today's progress
create or replace function public.checklist_get(p_list text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.checklists; d jsonb;
begin
  if not public.ck_can('tick') then return jsonb_build_object('error', 'not_allowed'); end if;
  if p_list is null then
    return jsonb_build_object('day', public.ck_today(), 'can_edit', public.ck_can('edit'), 'lists', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c2.id, 'title', c2.title,
      'total', (select count(*) from jsonb_array_elements(c2.items) i where not coalesce((i ->> 'head')::boolean, false)),
      'done', (select count(*) from jsonb_array_elements(c2.items) i where not coalesce((i ->> 'head')::boolean, false)
                 and coalesce(cd.done, '{}'::jsonb) ? (i ->> 'id'))) order by c2.sort), '[]'::jsonb)
      from public.checklists c2 left join public.checklist_days cd on cd.list_id = c2.id and cd.day = public.ck_today()));
  end if;
  select * into c from public.checklists where id = p_list;
  if not found then return jsonb_build_object('error', 'no_list'); end if;
  select done into d from public.checklist_days where list_id = p_list and day = public.ck_today();
  return jsonb_build_object('id', c.id, 'title', c.title, 'items', c.items, 'day', public.ck_today(), 'done', coalesce(d, '{}'::jsonb),
    'can_edit', public.ck_can('edit'), 'me', public.hub_me());
end $$;
revoke all on function public.checklist_get(text) from public, anon;
grant execute on function public.checklist_get(text) to authenticated;

create or replace function public.checklist_tick(p_list text, p_item text, p_on boolean, p_by text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if not public.ck_can('tick') then return jsonb_build_object('error', 'not_allowed'); end if;
  who := case when coalesce(public.staff_role() = 'hub', false) and length(trim(coalesce(p_by, ''))) > 0 then left(trim(p_by), 60) else public.hub_me() end;
  insert into public.checklist_days (list_id, day) values (p_list, public.ck_today()) on conflict do nothing;
  update public.checklist_days set done = case when p_on then done || jsonb_build_object(p_item, jsonb_build_object('by', who, 'at', now())) else done - p_item end
  where list_id = p_list and day = public.ck_today();
  return public.checklist_get(p_list);
end $$;
revoke all on function public.checklist_tick(text, text, boolean, text) from public, anon;
grant execute on function public.checklist_tick(text, text, boolean, text) to authenticated;

create or replace function public.checklist_save(p_list text, p_title text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.ck_can('edit') then return jsonb_build_object('error', 'not_allowed'); end if;
  if jsonb_typeof(p_items) <> 'array' then return jsonb_build_object('error', 'bad_items'); end if;
  update public.checklists set title = coalesce(nullif(trim(p_title), ''), title), items = p_items, updated_at = now() where id = p_list;
  return public.checklist_get(p_list);
end $$;
revoke all on function public.checklist_save(text, text, jsonb) from public, anon;
grant execute on function public.checklist_save(text, text, jsonb) to authenticated;

-- 10. Pre-shift and the Calendar as whole pages on the Hub (tap their cards): today's reservations (no guest spend, no raw email),
--     menu changes, notes and the education PDFs, to read only. The staff site's Pre-shift page uses these when it's on the Hub.
create or replace function public.hub_preshift_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; res jsonb;
begin
  if not (coalesce(public.staff_role() in ('hub', 'owner', 'manager'), false) or coalesce(public.can_schedule(), false)) then return null; end if;
  if to_regclass('public.preshift_days') is null then return null; end if;
  select * into r from public.preshift_days where service_date = (now() at time zone 'America/New_York')::date;
  if not found then return null; end if;
  res := coalesce(r.reservations, '{}'::jsonb) - 'text';
  if jsonb_typeof(res -> 'list') = 'array' then
    res := jsonb_set(res, '{list}', (select coalesce(jsonb_agg(case when jsonb_typeof(x -> 'guest') = 'object' then jsonb_set(x, '{guest}', (x -> 'guest') - 'spend') else x end), '[]'::jsonb)
                                     from jsonb_array_elements(res -> 'list') x));
  end if;
  if jsonb_typeof(res -> 'sections') = 'array' then
    res := jsonb_set(res, '{sections}', (select coalesce(jsonb_agg(case when jsonb_typeof(sx -> 'lines') = 'array' then jsonb_set(sx, '{lines}',
             (select coalesce(jsonb_agg(to_jsonb(regexp_replace(l, ',?\s*\$\s?[0-9,]+(\.[0-9]+)?\s*(average|avg\.?)\s+spend[a-z ]*', '', 'gi'))), '[]'::jsonb)
              from jsonb_array_elements_text(sx -> 'lines') l)) else sx end), '[]'::jsonb)
           from jsonb_array_elements(res -> 'sections') sx));
  end if;
  return jsonb_build_object('service_date', r.service_date, 'source_subject', r.source_subject, 'source_received', r.source_received,
    'source_forwarded', r.source_forwarded, 'reservations', res, 'updated_at', r.updated_at);
end $$;
revoke all on function public.hub_preshift_today() from public, anon;
grant execute on function public.hub_preshift_today() to authenticated;

do $hubps$ begin
  if to_regclass('public.activity_log') is not null then
    execute $fn$
create or replace function public.hub_menu_changes(p_hours int default 24) returns jsonb
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
  from g where coalesce(public.staff_role() in ('hub', 'owner', 'manager'), false) or coalesce(public.can_schedule(), false)
$$;
    $fn$;
    execute 'revoke all on function public.hub_menu_changes(int) from public, anon';
    execute 'grant execute on function public.hub_menu_changes(int) to authenticated';
  end if;
  if to_regclass('public.preshift_notes') is not null then
    execute 'drop policy if exists "hub reads pre-shift notes" on public.preshift_notes';
    execute $p$create policy "hub reads pre-shift notes" on public.preshift_notes for select to authenticated using (coalesce(public.staff_role() = 'hub', false))$p$;
  end if;
  if to_regclass('public.preshift_education') is not null then
    execute 'drop policy if exists "hub reads education" on public.preshift_education';
    execute $p$create policy "hub reads education" on public.preshift_education for select to authenticated using (coalesce(public.staff_role() = 'hub', false))$p$;
  end if;
  -- the whole Calendar page on the Hub (tap the Calendar card), to read only
  if to_regclass('public.events') is not null then
    execute 'drop policy if exists "hub reads events" on public.events';
    execute $p$create policy "hub reads events" on public.events for select to authenticated using (coalesce(public.staff_role() = 'hub', false))$p$;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "hub opens education pdfs" on storage.objects';
    execute $p$create policy "hub opens education pdfs" on storage.objects for select to authenticated
      using (bucket_id = 'preshift-education' and name not like 'resources/%' and coalesce(public.staff_role() = 'hub', false))$p$;
  end if;
end $hubps$;

-- 11. The schedule for any stretch of days (the Hub's month view): published weeks only; names, positions and times.
create or replace function public.hub_schedule(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (coalesce(public.staff_role() in ('hub', 'owner', 'manager'), false) or coalesce(public.can_schedule(), false)) then return jsonb_build_object('error', 'not_allowed'); end if;
  if to_regclass('public.schedule_weeks') is null or p_to < p_from or p_to - p_from > 62 then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('date', w.week_start + (s ->> 'day')::int,
      'name', coalesce(nullif(trim(e.name), ''), 'Team member'), 'position', coalesce(e.position, ''),
      'start', s ->> 'start', 'end', s ->> 'end', 'role', coalesce(s ->> 'role', ''), 'note', coalesce(s ->> 'note', ''))
      order by w.week_start + (s ->> 'day')::int, s ->> 'start', e.name), '[]'::jsonb)
    from public.schedule_weeks w
    cross join lateral jsonb_array_elements(coalesce(w.published, '[]'::jsonb)) s
    left join public.employees e on e.id::text = s ->> 'emp'
    where w.status = 'published' and w.week_start between p_from - 6 and p_to
      and w.week_start + (s ->> 'day')::int between p_from and p_to);
end $$;
revoke all on function public.hub_schedule(date, date) from public, anon;
grant execute on function public.hub_schedule(date, date) to authenticated;

-- 12. Time off from the Hub: someone picks their name, then asks for days off. It goes into the schedule's time-off
--     requests as pending, exactly like a request from the staff page, for the Owner or a manager to approve.
--     The Hub only sees active names and positions, and each person's own requests (dates and status, not reasons).
--     Anyone whose time-off requests are switched off in Team > Permissions isn't listed.
create or replace function public.hub_timeoff_ok(p_emp uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare lvl text; v boolean;
begin
  select case when e.access in ('cook', 'server', 'bartender') then e.access else 'employee' end into lvl from public.employees e where e.id = p_emp;
  if lvl is null then return false; end if;
  if to_regclass('public.section_people') is null or to_regclass('public.section_rules') is null then return true; end if;
  execute 'select coalesce((select allowed from public.section_people where employee_id = $1 and section = ''timeoff''),
                           (select allowed from public.section_rules where level = $2 and section = ''timeoff''), true)' into v using p_emp, lvl;
  return v;
end $$;
revoke all on function public.hub_timeoff_ok(uuid) from public, anon, authenticated;

create or replace function public.hub_timeoff_people() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (coalesce(public.staff_role() in ('hub', 'owner', 'manager'), false) or coalesce(public.can_schedule(), false)) then return jsonb_build_object('error', 'not_allowed'); end if;
  if to_regclass('public.time_off') is null then return jsonb_build_object('error', 'no_timeoff'); end if;
  return jsonb_build_object('people', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'position', coalesce(e.position, ''))
      order by coalesce(nullif(e.position, ''), '~'), e.name), '[]'::jsonb)
    from public.employees e where e.active and trim(coalesce(e.name, '')) <> '' and public.hub_timeoff_ok(e.id)));
end $$;
revoke all on function public.hub_timeoff_people() from public, anon;
grant execute on function public.hub_timeoff_people() to authenticated;

-- one person's requests from 30 days ago on: dates and status only
create or replace function public.hub_timeoff_list(p_emp uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (coalesce(public.staff_role() in ('hub', 'owner', 'manager'), false) or coalesce(public.can_schedule(), false)) then return jsonb_build_object('error', 'not_allowed'); end if;
  return jsonb_build_object('requests', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'start_date', t.start_date, 'end_date', t.end_date,
      'all_day', t.all_day, 'start_time', t.start_time, 'end_time', t.end_time, 'status', t.status, 'created_at', t.created_at) order by t.start_date), '[]'::jsonb)
    from public.time_off t where t.emp = p_emp and t.end_date >= (now() at time zone 'America/New_York')::date - 30));
end $$;
revoke all on function public.hub_timeoff_list(uuid) from public, anon;
grant execute on function public.hub_timeoff_list(uuid) to authenticated;

create or replace function public.hub_timeoff_request(p_emp uuid, p_from date, p_to date, p_all_day boolean, p_start text, p_end text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/New_York')::date;
begin
  if not (coalesce(public.staff_role() in ('hub', 'owner', 'manager'), false) or coalesce(public.can_schedule(), false)) then return jsonb_build_object('error', 'not_allowed'); end if;
  if not exists (select 1 from public.employees where id = p_emp and active) or not public.hub_timeoff_ok(p_emp) then return jsonb_build_object('error', 'not_allowed'); end if;
  if p_from is null or p_to is null or p_to < p_from then return jsonb_build_object('error', 'bad_dates'); end if;
  if p_from < today then return jsonb_build_object('error', 'past'); end if;
  if p_to - p_from > 60 then return jsonb_build_object('error', 'too_long'); end if;
  if not coalesce(p_all_day, true) and (coalesce(p_start, '') !~ '^\d{2}:\d{2}$') then return jsonb_build_object('error', 'bad_time'); end if;
  insert into public.time_off (emp, start_date, end_date, all_day, start_time, end_time, reason, status)
  values (p_emp, p_from, p_to, coalesce(p_all_day, true),
          case when coalesce(p_all_day, true) then '' else p_start end,
          case when coalesce(p_all_day, true) then '' else coalesce(p_end, '') end,
          left(trim(coalesce(p_reason, '')) || case when public.staff_role() = 'hub' then ' (requested on the Hub)' else '' end, 500), 'pending');
  return public.hub_timeoff_list(p_emp);
end $$;
revoke all on function public.hub_timeoff_request(uuid, date, date, boolean, text, text, text) from public, anon;
grant execute on function public.hub_timeoff_request(uuid, date, date, boolean, text, text, text) to authenticated;

-- 13. The end of day report can only be submitted once both closing checklists (Front of house closing and Back of
--     house closing) are fully ticked off for that night. Checked here in the database, so it can't be skipped;
--     the report page shows where they stand. Submitting also ticks the report's "Closing checklist completed".
--     Reopening and editing a report that's already submitted isn't affected.
create or replace function public.eod_closing_lists(p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title,
      'total', (select count(*) from jsonb_array_elements(c.items) i where not coalesce((i ->> 'head')::boolean, false)),
      'done', (select count(*) from jsonb_array_elements(c.items) i where not coalesce((i ->> 'head')::boolean, false)
                 and coalesce(d.done, '{}'::jsonb) ? (i ->> 'id'))) order by c.sort), '[]'::jsonb)
  from public.checklists c left join public.checklist_days d on d.list_id = c.id and d.day = p_date
  where c.id in ('foh-close', 'boh-close')
$$;
revoke all on function public.eod_closing_lists(date) from public, anon, authenticated;

create or replace function public.eod_closing_status(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l jsonb;
begin
  if not public.ck_can('tick') then return jsonb_build_object('error', 'not_allowed'); end if;
  l := public.eod_closing_lists(coalesce(p_date, public.ck_today()));
  return jsonb_build_object('day', coalesce(p_date, public.ck_today()), 'lists', l,
    'ready', not exists (select 1 from jsonb_array_elements(l) x where (x ->> 'done')::int < (x ->> 'total')::int));
end $$;
revoke all on function public.eod_closing_status(date) from public, anon;
grant execute on function public.eod_closing_status(date) to authenticated;

do $eodgate$ begin
  if to_regclass('public.eod_reports') is not null then
    execute $fn$
create or replace function public.eod_closing_gate() returns trigger
language plpgsql security definer set search_path = public as $g$
declare l jsonb; missing text;
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    l := public.eod_closing_lists(new.report_date);
    select string_agg((x ->> 'title') || ' ' || (x ->> 'done') || '/' || (x ->> 'total'), ', ') into missing
      from jsonb_array_elements(l) x where (x ->> 'done')::int < (x ->> 'total')::int;
    if missing is not null then
      raise exception 'closing_checklists: finish %', missing using errcode = 'P0001';
    end if;
    new.closing_done := true;
  end if;
  return new;
end $g$
    $fn$;
    execute 'drop trigger if exists eod_closing_gate on public.eod_reports';
    execute 'create trigger eod_closing_gate before insert or update on public.eod_reports for each row execute function public.eod_closing_gate()';
  end if;
end $eodgate$;

-- 6. Make the Hub's login (do this once, after adding the user in Authentication > Users):
--    change the email below to the one you used, then run just these three lines.
-- insert into public.staff (user_id, name, role)
-- select id, 'Hub', 'hub' from auth.users where email = 'hub@edencny.com'
-- on conflict (user_id) do update set role = 'hub', name = 'Hub';
