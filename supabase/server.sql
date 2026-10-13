-- Eden staff site: the Server permission.
-- Run AFTER supabase/access-and-timeoff.sql. Paste into Supabase > SQL Editor > New query, click Run.
-- Safe to run more than once (and safe to run before or after supabase/prep-list.sql).
--
-- Server: a permission on the Employees tab (only the Owner can set it), alongside Employee, Cook and Manager.
-- For now a server has the same access as an employee; is_server() lets later features (for example,
-- server-only pages) check for it.

alter table public.employees drop constraint if exists employees_access_check;
alter table public.employees add constraint employees_access_check check (access in ('employee', 'cook', 'server', 'bartender', 'manager'));

create or replace function public.is_server() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees
                 where active and access = 'server' and email <> ''
                   and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke execute on function public.is_server() from anon;
grant execute on function public.is_server() to authenticated;
