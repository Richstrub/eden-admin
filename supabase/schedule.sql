-- Eden staff site: employee schedule tables.
-- Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
-- Only the Owner and Managers can see or change employees and schedules
-- (mobile numbers stay private from other staff roles).

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null default '',
  position text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.schedule_weeks (
  week_start date primary key,                -- the Monday of the week
  shifts jsonb not null default '[]'::jsonb,  -- [{id, emp, day 0-6, start, end|'close', role, note}]
  status text not null default 'draft' check (status in ('draft','published')),
  published jsonb,                            -- copy of shifts at the last publish
  published_at timestamptz,
  sent jsonb not null default '{}'::jsonb,    -- employee id -> {at, msg} for texts sent
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);

alter table public.employees enable row level security;
alter table public.schedule_weeks enable row level security;

drop policy if exists "managers manage employees" on public.employees;
create policy "managers manage employees" on public.employees
  for all to authenticated
  using (public.staff_role() in ('owner','manager'))
  with check (public.staff_role() in ('owner','manager'));

drop policy if exists "managers manage schedules" on public.schedule_weeks;
create policy "managers manage schedules" on public.schedule_weeks
  for all to authenticated
  using (public.staff_role() in ('owner','manager'))
  with check (public.staff_role() in ('owner','manager'));

grant select, insert, update, delete on public.employees to authenticated;
grant select, insert, update, delete on public.schedule_weeks to authenticated;

create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists employees_touch on public.employees;
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_row();

create or replace function public.touch_week() returns trigger
language plpgsql as $$
begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end $$;

drop trigger if exists schedule_weeks_touch on public.schedule_weeks;
create trigger schedule_weeks_touch before update on public.schedule_weeks
  for each row execute function public.touch_week();
