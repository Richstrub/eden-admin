-- Eden staff site: the Hub (the touch screen in the restaurant, at edencny-staff.com/hub/).
-- Run AFTER supabase/schema.sql, access-and-timeoff.sql, notes.sql and team.sql (and permissions.sql, if you've run it).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- The Hub signs in with its own login, role 'hub' in the staff table. That login can open the Hub page and nothing
-- else: it is not on the team (no schedule, recipes, prep list, board or anything an employee sees), it can't use the
-- staff site, and it never sees pay, phone numbers or guest spend. The Owner and managers can open the Hub too.
-- To make the Hub's login, see the steps in the reply / README (Authentication > Users > Add user, then the insert below).

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

-- 3. who may open the Hub page: the Hub login, the Owner and managers
create or replace function public.hub_ok() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', coalesce(public.staff_role() in ('hub', 'owner', 'manager'), false) or coalesce(public.can_schedule(), false),
    'hub', coalesce(public.staff_role() = 'hub', false))
$$;
revoke all on function public.hub_ok() from public, anon;
grant execute on function public.hub_ok() to authenticated;

-- 4. Make the Hub's login (do this once, after adding the user in Authentication > Users):
--    change the email below to the one you used, then run just these three lines.
-- insert into public.staff (user_id, name, role)
-- select id, 'Hub', 'hub' from auth.users where email = 'hub@edencny.com'
-- on conflict (user_id) do update set role = 'hub', name = 'Hub';
