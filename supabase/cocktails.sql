-- Eden staff site: Recipes → Cocktail builds, and the monthly cocktail tally (liquor used from cocktail sales).
-- Run AFTER supabase/recipes.sql and supabase/inventory.sql. Paste into Supabase > SQL Editor > New query and click Run.
-- Safe to run more than once.
--
-- cocktail_builds  each cocktail's build: [{ qty, unit, item, inv_id }] (inv_id links a spirit to its inventory item),
--                  the menu cocktail it's sold as, glass, garnish, method.
-- cocktail_sales   one row per month: how many of each cocktail sold, from the bartender's tally sheet { build_id: count }.
-- The team can read builds; the Owner and Managers change them and enter the monthly counts.

create table if not exists public.cocktail_builds (
  id          text primary key,
  name        text not null,
  menu_name   text not null default '',
  glass       text not null default '',
  garnish     text not null default '',
  ice         text not null default '',
  method      text not null default '',
  ingredients jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  sort        integer not null default 0,
  updated_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.cocktail_sales (
  month       date primary key,                   -- the first day of the month
  counts      jsonb not null default '{}'::jsonb,
  notes       text not null default '',
  entered_by  text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.cocktail_builds enable row level security;
alter table public.cocktail_sales enable row level security;
revoke all on public.cocktail_builds, public.cocktail_sales from anon;
grant select, insert, update, delete on public.cocktail_builds, public.cocktail_sales to authenticated;
drop policy if exists "team reads" on public.cocktail_builds;
create policy "team reads" on public.cocktail_builds for select to authenticated using (public.is_team());
drop policy if exists "managers write" on public.cocktail_builds;
create policy "managers write" on public.cocktail_builds for all to authenticated using (public.can_schedule()) with check (public.can_schedule());
drop policy if exists "managers" on public.cocktail_sales;
create policy "managers" on public.cocktail_sales for all to authenticated using (public.can_schedule()) with check (public.can_schedule());
