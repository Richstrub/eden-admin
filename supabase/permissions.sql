-- Eden staff site: Permissions (Team > Employees > Permissions). The Owner chooses what each kind of employee
-- (Employee, Cook, Server) can see and do on the staff page, with exceptions for one person.
-- Run AFTER: team.sql, access-and-timeoff.sql, todo-assign.sql, recipes.sql, calendar.sql, preshift.sql, resources.sql,
-- prep-list.sql and server.sql. Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
-- If one of those hasn't been run yet, its section is skipped (not an error); run this file again after running it.
-- If you run any of those files again later, run this one again afterwards.
--
-- Sections, and the finer controls inside them (a finer control only matters when its section is on):
--   schedule (their own shifts)         schedule.team (everyone's shifts: who they're working with)
--   todos (to-dos given to them)        todos.done (ticking them off)
--   timeoff (asking for time off)
--   board (reading the message board)   board.post (posting on it)
--   preshift (the Pre-shift tab)        preshift.education, preshift.reservations, preshift.menu, preshift.notes
--   resources                           recipes        calendar
--   prep (seeing the Prep List)         prep.edit (filling it in)
-- Out of the box everything is on, except the Prep List (cooks only). The Owner and managers always have everything.
-- Kitchen logins count as cooks and Front-of-house logins as servers. This is enforced by the database, not just hidden.

create table if not exists public.section_rules (
  level    text not null check (level in ('employee', 'cook', 'server')),
  section  text not null,
  allowed  boolean not null,
  updated_at timestamptz not null default now(),
  primary key (level, section)
);
create table if not exists public.section_people (
  employee_id uuid not null references public.employees (id) on delete cascade,
  section  text not null,
  allowed  boolean not null,
  updated_at timestamptz not null default now(),
  primary key (employee_id, section)
);
alter table public.section_rules drop constraint if exists section_rules_section_check;
alter table public.section_rules add constraint section_rules_section_check check (section in ('schedule', 'schedule.team', 'todos', 'todos.done', 'timeoff', 'board', 'board.post', 'preshift', 'preshift.education', 'preshift.reservations', 'preshift.menu', 'preshift.notes', 'resources', 'prep', 'prep.edit', 'recipes', 'calendar'));
alter table public.section_people drop constraint if exists section_people_section_check;
alter table public.section_people add constraint section_people_section_check check (section in ('schedule', 'schedule.team', 'todos', 'todos.done', 'timeoff', 'board', 'board.post', 'preshift', 'preshift.education', 'preshift.reservations', 'preshift.menu', 'preshift.notes', 'resources', 'prep', 'prep.edit', 'recipes', 'calendar'));
alter table public.section_rules enable row level security;
alter table public.section_people enable row level security;
revoke all on public.section_rules, public.section_people from anon;
grant select, insert, update, delete on public.section_rules, public.section_people to authenticated;
drop policy if exists "owner sets permissions" on public.section_rules;
create policy "owner sets permissions" on public.section_rules for all to authenticated
  using (coalesce(public.access_level() = 'owner', false)) with check (coalesce(public.access_level() = 'owner', false));
drop policy if exists "owner sets exceptions" on public.section_people;
create policy "owner sets exceptions" on public.section_people for all to authenticated
  using (coalesce(public.access_level() = 'owner', false)) with check (coalesce(public.access_level() = 'owner', false));

-- what kind of employee the signed-in person is: employee, cook or server
create or replace function public.my_level() returns text
language sql stable security definer set search_path = public as $$
  select case public.staff_role() when 'kitchen' then 'cook' when 'foh' then 'server' else
    coalesce((select case when e.access in ('cook', 'server') then e.access else 'employee' end from public.employees e where e.id = public.my_employee_id()), 'employee') end
$$;

-- may the signed-in person use this section (or finer control, like 'board.post')?
-- A finer control needs its section on too. Then: this person's exception, else their group's setting, else the default.
create or replace function public.section_ok(p_section text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parent text := split_part(p_section, '.', 1);
begin
  if coalesce(public.access_level() in ('owner', 'manager'), false) or coalesce(public.staff_role() in ('owner', 'manager'), false) then return true; end if;
  if p_section <> parent and not public.section_ok(parent) then return false; end if;
  return coalesce(
    (select p.allowed from public.section_people p where p.employee_id = public.my_employee_id() and p.section = p_section),
    (select r.allowed from public.section_rules r where r.level = public.my_level() and r.section = p_section),
    case when p_section = 'prep' then public.my_level() = 'cook' else true end);
end $$;
revoke all on function public.my_level(), public.section_ok(text) from public, anon;
grant execute on function public.my_level(), public.section_ok(text) to authenticated;

-- everything at once, for the staff page and staff site menus
create or replace function public.my_sections() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, public.section_ok(k)) || jsonb_build_object('level', public.my_level())
  from unnest(array['schedule', 'schedule.team', 'todos', 'todos.done', 'timeoff', 'board', 'board.post', 'preshift', 'preshift.education', 'preshift.reservations', 'preshift.menu', 'preshift.notes', 'resources', 'prep', 'prep.edit', 'recipes', 'calendar']) k
$$;
revoke all on function public.my_sections() from public, anon;
grant execute on function public.my_sections() to authenticated;

/* ---------- each section, checked ---------- */

-- Prep List: the Owner, managers, and whoever Permissions allows (cooks and Kitchen logins out of the box)
create or replace function public.can_prep() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.staff_role() in ('owner', 'manager'), false) or coalesce(public.can_schedule(), false) then return true; end if;
  if not coalesce(public.is_team(), false) then return false; end if;
  if to_regprocedure('public.section_ok(text)') is not null then return coalesce(public.section_ok('prep'), false); end if;
  return coalesce(public.staff_role() = 'kitchen', false) or coalesce(public.is_cook(), false);
end $$;
revoke execute on function public.can_prep() from anon;
grant execute on function public.can_prep() to authenticated;


-- Prep List (filling it in)
do $guard$ begin
  if to_regclass('public.prep_lists') is not null then
    execute $q$
create or replace function public.prep_set(p_key text, p_field text, p_value text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; v jsonb;
begin
  if not coalesce(public.can_prep(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  if to_regprocedure('public.section_ok(text)') is not null and not coalesce(public.section_ok('prep.edit'), false) then return jsonb_build_object('error', 'view_only'); end if;   -- Team > Permissions
  if p_field not in ('done', 'onhand', 'prep', 'ini') or length(coalesce(p_key, '')) not between 1 and 400 then return jsonb_build_object('error', 'bad'); end if;
  perform public.prep_auto();
  v := case when p_field = 'done' then to_jsonb(coalesce(p_value, '') in ('true', '1', 'yes')) else to_jsonb(left(coalesce(p_value, ''), case when p_field = 'ini' then 6 else 40 end)) end;
  select coalesce(entries -> p_key, '{}'::jsonb) into cur from public.prep_lists where id = 'eden' for update;
  cur := cur || jsonb_build_object(p_field, v, 'by', public.prep_me(), 'at', now());
  update public.prep_lists set entries = jsonb_set(entries, array[p_key], cur, true), updated_at = now() where id = 'eden';
  return jsonb_build_object('ok', true, 'entry', cur);
end $$
    $q$;
    execute $q$
create or replace function public.prep_extra(p_section text, p_name text, p_add boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; nm text := left(trim(coalesce(p_name, '')), 120);
begin
  if not coalesce(public.can_prep(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  if to_regprocedure('public.section_ok(text)') is not null and not coalesce(public.section_ok('prep.edit'), false) then return jsonb_build_object('error', 'view_only'); end if;   -- Team > Permissions
  if nm = '' or length(coalesce(p_section, '')) not between 1 and 200 then return jsonb_build_object('error', 'bad'); end if;
  select coalesce(extra -> p_section, '[]'::jsonb) into cur from public.prep_lists where id = 'eden' for update;
  cur := coalesce((select jsonb_agg(x) from jsonb_array_elements_text(cur) x where lower(x) <> lower(nm)), '[]'::jsonb);
  if p_add then cur := cur || to_jsonb(nm); end if;
  update public.prep_lists set extra = case when jsonb_array_length(cur) = 0 then extra - p_section else jsonb_set(extra, array[p_section], cur, true) end, updated_at = now() where id = 'eden';
  return public.prep_row();
end $$
    $q$;
    execute $q$
create or replace function public.prep_hide(p_key text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_prep(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  if to_regprocedure('public.section_ok(text)') is not null and not coalesce(public.section_ok('prep.edit'), false) then return jsonb_build_object('error', 'view_only'); end if;   -- Team > Permissions
  if p_key is null then update public.prep_lists set removed = '{}'::jsonb, updated_at = now() where id = 'eden';
  elsif p_on then update public.prep_lists set removed = jsonb_set(removed, array[p_key], '1'::jsonb, true), updated_at = now() where id = 'eden';
  else update public.prep_lists set removed = removed - p_key, updated_at = now() where id = 'eden'; end if;
  return public.prep_row();
end $$
    $q$;
    execute $q$
create or replace function public.prep_import(p_extra jsonb, p_removed jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_prep(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  if to_regprocedure('public.section_ok(text)') is not null and not coalesce(public.section_ok('prep.edit'), false) then return jsonb_build_object('error', 'view_only'); end if;   -- Team > Permissions
  update public.prep_lists set
    extra = case when extra = '{}'::jsonb and jsonb_typeof(p_extra) = 'object' then p_extra else extra end,
    removed = case when removed = '{}'::jsonb and jsonb_typeof(p_removed) = 'object' then p_removed else removed end,
    updated_at = now() where id = 'eden';
  return public.prep_row();
end $$
    $q$;
  else raise notice 'Skipped Prep List (filling it in): run its SQL file first, then run this one again.';
  end if;
end $guard$;

-- Schedule
do $guard$ begin
  if to_regclass('public.schedule_weeks') is not null then
    execute $q$
create or replace function public.team_schedule(p_week date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w public.schedule_weeks%rowtype; me uuid; res jsonb; everyone boolean := true;
begin
  if not public.is_team() then raise exception 'not on the staff list' using errcode = '42501'; end if;
  if to_regprocedure('public.section_ok(text)') is not null and not public.section_ok('schedule') then raise exception 'section_off' using errcode = '42501'; end if;   -- Team > Permissions
  if to_regprocedure('public.section_ok(text)') is not null then everyone := coalesce(public.section_ok('schedule.team'), false); end if;
  me := public.my_employee_id();
  select * into w from public.schedule_weeks where week_start = p_week and status = 'published';
  if not found then
    return jsonb_build_object('week_start', p_week, 'published', false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', coalesce(nullif(trim(e.name), ''), 'Team member'),
      'position', coalesce(e.position, ''),
      'mine', me is not null and (s ->> 'emp') = me::text,
      'day', (s ->> 'day')::int,
      'start', s ->> 'start',
      'end', s ->> 'end',
      'role', coalesce(s ->> 'role', ''),
      'note', coalesce(s ->> 'note', ''))
      order by (s ->> 'day')::int, s ->> 'start'), '[]'::jsonb)
    into res
  from jsonb_array_elements(coalesce(w.published, '[]'::jsonb)) s
  left join public.employees e on e.id::text = s ->> 'emp'
  where everyone or (me is not null and (s ->> 'emp') = me::text);
  return jsonb_build_object('week_start', p_week, 'published', true, 'published_at', w.published_at, 'shifts', res);
end $$
    $q$;
  else raise notice 'Skipped Schedule: run its SQL file first, then run this one again.';
  end if;
end $guard$;

-- To-dos
do $guard$ begin
  if to_regclass('public.todos') is not null then
    execute $q$
create or replace function public.my_todos() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'details', t.details, 'due', t.due, 'done', t.done, 'done_at', t.done_at,
      'assigned_by', coalesce(nullif(t.assigned_by, ''), t.created_by), 'created_at', t.created_at)
    order by t.done, t.due nulls last, t.created_at), '[]'::jsonb)
  from public.todos t
  where public.my_employee_id() is not null
    and t.assigned_to = public.my_employee_id()
    and (not t.done or t.done_at > now() - interval '7 days')
    and public.section_ok('todos')
$$
    $q$;
    execute $q$
create or replace function public.finish_my_todo(p_id text, p_done boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('public.section_ok(text)') is not null and not public.section_ok('todos.done') then return jsonb_build_object('ok', false); end if;   -- Team > Permissions
  update public.todos set done = p_done, done_at = case when p_done then now() end
  where id = p_id and assigned_to is not null and assigned_to = public.my_employee_id();
  return jsonb_build_object('ok', found);
end $$
    $q$;
    execute $q$
revoke all on function public.my_todos(), public.finish_my_todo(text, boolean) from public, anon
    $q$;
    execute $q$
grant execute on function public.my_todos(), public.finish_my_todo(text, boolean) to authenticated
    $q$;
  else raise notice 'Skipped To-dos: run its SQL file first, then run this one again.';
  end if;
end $guard$;

-- Time off
do $guard$ begin
  if to_regclass('public.time_off') is not null then
    execute $q$
drop policy if exists "see own or manage time off" on public.time_off
    $q$;
    execute $q$
create policy "see own or manage time off" on public.time_off for select to authenticated using (public.can_schedule() or (emp = public.my_employee_id() and public.section_ok('timeoff')))
    $q$;
    execute $q$
drop policy if exists "request time off" on public.time_off
    $q$;
    execute $q$
create policy "request time off" on public.time_off for insert to authenticated with check (public.can_schedule() or (emp = public.my_employee_id() and status = 'pending' and public.section_ok('timeoff')))
    $q$;
    execute $q$
drop policy if exists "cancel pending or manage time off" on public.time_off
    $q$;
    execute $q$
create policy "cancel pending or manage time off" on public.time_off for delete to authenticated using (public.can_schedule() or (emp = public.my_employee_id() and status = 'pending' and public.section_ok('timeoff')))
    $q$;
  else raise notice 'Skipped Time off: run its SQL file first, then run this one again.';
  end if;
end $guard$;

-- Message board
do $guard$ begin
  if to_regclass('public.board_posts') is not null then
    execute $q$
drop policy if exists "team reads the board" on public.board_posts
    $q$;
    execute $q$
create policy "team reads the board" on public.board_posts for select to authenticated using (public.is_team() and public.section_ok('board'))
    $q$;
    execute $q$
drop policy if exists "team posts to the board" on public.board_posts
    $q$;
    execute $q$
create policy "team posts to the board" on public.board_posts for insert to authenticated with check (public.is_team() and public.section_ok('board.post') and author = auth.uid())
    $q$;
  else raise notice 'Skipped Message board: run its SQL file first, then run this one again.';
  end if;
end $guard$;

-- Pre-shift
do $guard$ begin
  if to_regclass('public.preshift_notes') is not null and to_regclass('public.preshift_education') is not null and to_regclass('public.preshift_days') is not null then
    execute $q$
drop policy if exists "team reads pre-shift notes" on public.preshift_notes
    $q$;
    execute $q$
create policy "team reads pre-shift notes" on public.preshift_notes for select to authenticated using (public.is_team() and public.section_ok('preshift.notes'))
    $q$;
    execute $q$
drop policy if exists "team reads education" on public.preshift_education
    $q$;
    execute $q$
create policy "team reads education" on public.preshift_education for select to authenticated using (public.is_team() and public.section_ok('preshift.education'))
    $q$;
    execute $q$
create or replace function public.preshift_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.preshift_days; res jsonb; mgr boolean := coalesce(public.can_schedule(), false);
begin
  if not coalesce(public.is_team(), false) then return null; end if;
  if not public.section_ok('preshift.reservations') then return null; end if;   -- Team > Permissions
  select * into r from public.preshift_days where service_date = (now() at time zone 'America/New_York')::date;
  if not found then return null; end if;
  res := coalesce(r.reservations, '{}'::jsonb);
  if not mgr then
    res := res - 'text';
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
  end if;
  return jsonb_build_object('service_date', r.service_date, 'source_subject', r.source_subject, 'source_received', r.source_received,
    'source_forwarded', r.source_forwarded, 'reservations', res, 'updated_at', r.updated_at);
end $$
    $q$;
    execute $q$
revoke all on function public.preshift_today() from public, anon
    $q$;
    execute $q$
grant execute on function public.preshift_today() to authenticated
    $q$;
  else raise notice 'Skipped Pre-shift: run its SQL file first, then run this one again.';
  end if;
end $guard$;

-- Pre-shift menu changes
do $guard$ begin
  if to_regclass('public.activity_log') is not null then
    execute $q$
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
  from g where public.is_team() and public.section_ok('preshift.menu')
$$
    $q$;
    execute $q$
revoke all on function public.menu_changes(int) from public, anon
    $q$;
    execute $q$
grant execute on function public.menu_changes(int) to authenticated
    $q$;
  else raise notice 'Skipped Pre-shift menu changes: run its SQL file first, then run this one again.';
  end if;
end $guard$;

-- Resources
do $guard$ begin
  if to_regclass('public.resources') is not null then
    execute $q$
drop policy if exists "team reads resources" on public.resources
    $q$;
    execute $q$
create policy "team reads resources" on public.resources for select to authenticated using (public.is_team() and public.section_ok('resources'))
    $q$;
  else raise notice 'Skipped Resources: run its SQL file first, then run this one again.';
  end if;
end $guard$;

-- Files: Resources PDFs and Pre-shift's education PDFs share one private folder
drop policy if exists "team opens education pdfs" on storage.objects;
create policy "team opens education pdfs" on storage.objects for select to authenticated
  using (bucket_id = 'preshift-education' and public.is_team()
         and case when name like 'resources/%' then public.section_ok('resources') else public.section_ok('preshift.education') end);

-- Recipes
do $guard$ begin
  if to_regclass('public.recipes') is not null then
    execute $q$
drop policy if exists "team reads recipes" on public.recipes
    $q$;
    execute $q$
create policy "team reads recipes" on public.recipes for select to authenticated using (public.is_team() and public.section_ok('recipes'))
    $q$;
  else raise notice 'Skipped Recipes: run its SQL file first, then run this one again.';
  end if;
end $guard$;

-- Calendar
do $guard$ begin
  if to_regclass('public.events') is not null then
    execute $q$
drop policy if exists "team reads events" on public.events
    $q$;
    execute $q$
create policy "team reads events" on public.events for select to authenticated using (public.is_team() and public.section_ok('calendar'))
    $q$;
  else raise notice 'Skipped Calendar: run its SQL file first, then run this one again.';
  end if;
end $guard$;
