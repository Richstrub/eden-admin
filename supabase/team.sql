-- Eden staff site: team logins, the staff schedule page and the message board.
-- Run AFTER supabase/schedule.sql. Paste into Supabase > SQL Editor > New query and click Run.
-- Safe to run more than once.
--
-- What employees can see (through the functions below, never the tables directly):
--   * published schedules only, with each person shown as first name + last initial and position
--   * the message board
-- They can never read phone numbers, emails, drafts or the employees table.

-- 1. Email on each employee: this is what lets them create a login
alter table public.employees add column if not exists email text not null default '';
create unique index if not exists employees_email_unique on public.employees (lower(email)) where email <> '';

-- 2. Helpers
create or replace function public.short_name(full_name text) returns text
language sql immutable as $$
  select case when position(' ' in trim(coalesce(full_name, ''))) > 0
    then split_part(trim(full_name), ' ', 1) || ' ' || left(regexp_replace(trim(full_name), '^.*\s', ''), 1) || '.'
    else trim(coalesce(full_name, '')) end
$$;

create or replace function public.my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.employees
  where active and email <> '' and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select public.staff_role() is not null or public.my_employee_id() is not null
$$;

-- who am I (for the team page header)
create or replace function public.team_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'employee', (select jsonb_build_object('id', id, 'name', name, 'position', position)
                 from public.employees where id = public.my_employee_id()),
    'role', public.staff_role())
$$;

-- 3. The published schedule for a week, without any contact details
create or replace function public.team_schedule(p_week date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w public.schedule_weeks%rowtype; me uuid; res jsonb;
begin
  if not public.is_team() then raise exception 'not on the staff list' using errcode = '42501'; end if;
  me := public.my_employee_id();
  select * into w from public.schedule_weeks where week_start = p_week and status = 'published';
  if not found then
    return jsonb_build_object('week_start', p_week, 'published', false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', coalesce(public.short_name(e.name), 'Team member'),
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
  left join public.employees e on e.id::text = s ->> 'emp';
  return jsonb_build_object('week_start', p_week, 'published', true, 'published_at', w.published_at, 'shifts', res);
end $$;

-- 4. Which employees have created their login (shown to Owner/Manager in the admin table)
create or replace function public.employee_accounts() returns table (email text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select lower(u.email)::text, u.created_at, u.last_sign_in_at
  from auth.users u
  where public.staff_role() in ('owner', 'manager')
    and lower(u.email) in (select lower(e.email) from public.employees e where e.email <> '')
$$;

revoke execute on function public.team_me() from anon;
revoke execute on function public.team_schedule(date) from anon;
revoke execute on function public.employee_accounts() from anon;
grant execute on function public.team_me() to authenticated;
grant execute on function public.team_schedule(date) to authenticated;
grant execute on function public.employee_accounts() to authenticated;

-- 5. Only emails on the employee list can create an account
create or replace function public.only_team_signups() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.employees where email <> '' and lower(email) = lower(new.email)) then
    return new;
  end if;
  raise exception 'This email is not on the Eden staff list';
end $$;
drop trigger if exists only_team_signups on auth.users;
create trigger only_team_signups before insert on auth.users
  for each row execute function public.only_team_signups();

-- 6. Message board
create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.board_posts enable row level security;

create or replace function public.board_set_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author := auth.uid();
  new.created_at := now();
  new.author_name := coalesce(
    (select public.short_name(name) from public.employees where id = public.my_employee_id()),
    (select public.short_name(name) from public.staff where user_id = auth.uid()),
    'Team member');
  return new;
end $$;
drop trigger if exists board_set_author on public.board_posts;
create trigger board_set_author before insert on public.board_posts
  for each row execute function public.board_set_author();

drop policy if exists "team reads the board" on public.board_posts;
create policy "team reads the board" on public.board_posts
  for select to authenticated using (public.is_team());
drop policy if exists "team posts to the board" on public.board_posts;
create policy "team posts to the board" on public.board_posts
  for insert to authenticated with check (public.is_team() and author = auth.uid());
drop policy if exists "authors and managers remove posts" on public.board_posts;
create policy "authors and managers remove posts" on public.board_posts
  for delete to authenticated using (author = auth.uid() or public.staff_role() in ('owner', 'manager'));

grant select, insert, delete on public.board_posts to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.board_posts;
exception when duplicate_object then null;
end $$;
