-- Eden staff site: the recipe book.
-- Run AFTER supabase/access-and-timeoff.sql. Paste into Supabase > SQL Editor > New query, click Run.
-- Safe to run more than once.
--
-- Reading: everyone on the team (staff-site logins and every employee with a staff-page login).
-- Writing: the Owner and Managers only.

create table if not exists public.recipes (
  id          text primary key,
  name        text not null,
  category    text not null default '',
  yield_qty   numeric,
  yield_unit  text not null default '',
  time        text not null default '',
  allergens   text not null default '',
  ingredients jsonb not null default '[]'::jsonb,   -- [{qty, unit, item, note} | {head: true, item}]
  method      text not null default '',
  notes       text not null default '',
  updated_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

grant select, insert, update, delete on public.recipes to authenticated;
alter table public.recipes enable row level security;

drop policy if exists "team reads recipes" on public.recipes;
create policy "team reads recipes" on public.recipes
  for select to authenticated using (public.is_team());

drop policy if exists "managers write recipes" on public.recipes;
create policy "managers write recipes" on public.recipes
  for insert to authenticated with check (public.can_schedule());
drop policy if exists "managers change recipes" on public.recipes;
create policy "managers change recipes" on public.recipes
  for update to authenticated using (public.can_schedule()) with check (public.can_schedule());
drop policy if exists "managers remove recipes" on public.recipes;
create policy "managers remove recipes" on public.recipes
  for delete to authenticated using (public.can_schedule());

drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch before update on public.recipes for each row execute function public.touch_row();
