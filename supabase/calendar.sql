-- Eden staff site: events calendar.
-- Run AFTER supabase/access-and-timeoff.sql. Paste into Supabase > SQL Editor > New query, click Run.
-- Safe to run more than once.
--
-- Reading: everyone on the team. Adding / changing events: the Owner and Managers
-- (the staff-table Manager role, or employees set to Manager on the Employees tab).

create table if not exists public.events (
  id          text primary key,
  title       text not null,
  type        text not null default 'private',   -- private, supper, catering, meeting, closed, other
  date        date not null,
  all_day     boolean not null default false,
  start       text not null default '',          -- 'HH:MM'
  "end"       text not null default '',          -- 'HH:MM' or '' if open-ended
  room        text not null default '',
  guests      integer,
  notes       text not null default '',
  source      text not null default 'manual',    -- 'manual' now; 'beo' when BEOs add events
  beo_id      text,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists events_date on public.events (date);

grant select, insert, update, delete on public.events to authenticated;
alter table public.events enable row level security;

drop policy if exists "team reads events" on public.events;
create policy "team reads events" on public.events for select to authenticated using (public.is_team());
drop policy if exists "managers add events" on public.events;
create policy "managers add events" on public.events for insert to authenticated with check (public.can_schedule());
drop policy if exists "managers change events" on public.events;
create policy "managers change events" on public.events for update to authenticated using (public.can_schedule()) with check (public.can_schedule());
drop policy if exists "managers remove events" on public.events;
create policy "managers remove events" on public.events for delete to authenticated using (public.can_schedule());

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events for each row execute function public.touch_row();
