-- Eden staff site: smoother account set-up for employees (the staff page's "Create account").
-- Run AFTER supabase/team.sql. Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- 1. Employee emails are stored tidy (no stray spaces or capitals), so "Ava@Gmail.com " on the Employees tab
--    matches the "ava@gmail.com" an employee types.
-- 2. The staff page can check an email before creating an account, to tell the person exactly what's wrong
--    (not on the staff list yet, already has an account, or still waiting on the confirmation email).

create or replace function public.employees_tidy_email() returns trigger language plpgsql as $$
begin
  new.email := lower(trim(coalesce(new.email, '')));
  return new;
end $$;
drop trigger if exists employees_tidy_email on public.employees;
create trigger employees_tidy_email before insert or update of email on public.employees
  for each row execute function public.employees_tidy_email();
update public.employees set email = lower(trim(email)) where email <> lower(trim(email));

-- only emails on the employee list (active people) can create an account; spaces and capitals don't matter
create or replace function public.only_team_signups() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.employees where email <> '' and lower(trim(email)) = lower(trim(new.email))) then
    return new;
  end if;
  raise exception 'This email is not on the Eden staff list';
end $$;

-- "Create account" asks this first. Answers only: on the staff list or not, and whether an account exists.
create or replace function public.staff_signup_check(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare e text := lower(trim(coalesce(p_email, ''))); listed boolean; u record;
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('listed', false); end if;
  select exists (select 1 from public.employees where email = e and active) into listed;
  if not listed then return jsonb_build_object('listed', false); end if;
  select id, email_confirmed_at into u from auth.users where lower(email) = e limit 1;
  return jsonb_build_object('listed', true, 'account', u.id is not null, 'confirmed', u.email_confirmed_at is not null);
end $$;
revoke all on function public.staff_signup_check(text) from public;
grant execute on function public.staff_signup_check(text) to anon, authenticated;
