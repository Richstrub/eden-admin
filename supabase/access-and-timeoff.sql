-- Eden staff site: access levels (Employee / Manager) and time-off requests.
-- Run AFTER supabase/schedule.sql and supabase/team.sql.
-- Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
--
-- Access levels (set per person on the Employees tab; only the Owner can change them):
--   employee  sees the posted schedule, requests time off, uses the message board
--   manager   also edits and publishes the schedule, approves time off, sees the employee list
-- The Owner (and anyone with the older staff-table Manager role) is above both.

-- 1. Access level on each employee
alter table public.employees add column if not exists access text not null default 'employee';
do $$ begin
  alter table public.employees add constraint employees_access_check check (access in ('employee', 'manager'));
exception when duplicate_object then null;
end $$;

-- 2. Who is signed in, as an access level: owner, manager, employee or null
create or replace function public.access_level() returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.staff_role() = 'owner' then 'owner'
    when public.staff_role() = 'manager' then 'manager'
    when exists (select 1 from public.employees
                 where active and access = 'manager' and email <> ''
                   and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) then 'manager'
    when public.staff_role() is not null or public.my_employee_id() is not null then 'employee'
    else null end
$$;

create or replace function public.can_schedule() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.access_level() in ('owner', 'manager'), false)
$$;

revoke execute on function public.access_level() from anon;
grant execute on function public.access_level() to authenticated;

-- 3. Schedules and the employee list: Owner and Managers
drop policy if exists "managers manage employees" on public.employees;
create policy "managers manage employees" on public.employees
  for all to authenticated
  using (public.can_schedule())
  with check (public.can_schedule());

drop policy if exists "managers manage schedules" on public.schedule_weeks;
create policy "managers manage schedules" on public.schedule_weeks
  for all to authenticated
  using (public.can_schedule())
  with check (public.can_schedule());

-- only the Owner can change anyone's access level
create or replace function public.guard_employee_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- (an upsert of an existing row first arrives here as an INSERT; only a real change counts)
  if (tg_op = 'INSERT' and new.access <> 'employee'
        and not exists (select 1 from public.employees x where x.id = new.id and x.access = new.access))
     or (tg_op = 'UPDATE' and new.access is distinct from old.access) then
    if coalesce(public.access_level(), '') <> 'owner' then
      raise exception 'Only the Owner can change permissions' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_employee_access on public.employees;
create trigger guard_employee_access before insert or update on public.employees
  for each row execute function public.guard_employee_access();

-- account status in the admin table, for Owner and Managers
create or replace function public.employee_accounts() returns table (email text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select lower(u.email)::text, u.created_at, u.last_sign_in_at
  from auth.users u
  where public.can_schedule()
    and lower(u.email) in (select lower(e.email) from public.employees e where e.email <> '')
$$;

-- managers can remove message board posts
drop policy if exists "authors and managers remove posts" on public.board_posts;
create policy "authors and managers remove posts" on public.board_posts
  for delete to authenticated using (author = auth.uid() or public.can_schedule());

-- team page header: who am I, and my access level
create or replace function public.team_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'employee', (select jsonb_build_object('id', id, 'name', name, 'position', position)
                 from public.employees where id = public.my_employee_id()),
    'role', public.staff_role(),
    'access', public.access_level())
$$;

-- 4. Time-off requests
create table if not exists public.time_off (
  id uuid primary key default gen_random_uuid(),
  emp uuid not null references public.employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  start_time text not null default '',
  end_time text not null default '',
  reason text not null default '' check (char_length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  requested_by uuid default auth.uid(),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
alter table public.time_off enable row level security;

-- employees: see, request and cancel (while pending) their own; managers: everything
drop policy if exists "see own or manage time off" on public.time_off;
create policy "see own or manage time off" on public.time_off
  for select to authenticated using (public.can_schedule() or emp = public.my_employee_id());
drop policy if exists "request time off" on public.time_off;
create policy "request time off" on public.time_off
  for insert to authenticated with check (public.can_schedule() or (emp = public.my_employee_id() and status = 'pending'));
drop policy if exists "managers decide time off" on public.time_off;
create policy "managers decide time off" on public.time_off
  for update to authenticated using (public.can_schedule()) with check (public.can_schedule());
drop policy if exists "cancel pending or manage time off" on public.time_off;
create policy "cancel pending or manage time off" on public.time_off
  for delete to authenticated using (public.can_schedule() or (emp = public.my_employee_id() and status = 'pending'));

create or replace function public.time_off_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    new.created_at := now();
    if not public.can_schedule() then
      new.status := 'pending'; new.decided_by := null; new.decided_at := null; new.decision_note := '';
    elsif new.status <> 'pending' then
      new.decided_by := auth.uid(); new.decided_at := now();
    end if;
  elsif new.status is distinct from old.status then
    new.decided_by := auth.uid(); new.decided_at := now();
  end if;
  return new;
end $$;
drop trigger if exists time_off_stamp on public.time_off;
create trigger time_off_stamp before insert or update on public.time_off
  for each row execute function public.time_off_stamp();

grant select, insert, update, delete on public.time_off to authenticated;
