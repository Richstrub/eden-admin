-- Eden staff site: inventory (Food, Paper goods, Beer/Wine/Liquor).
-- Run AFTER supabase/access-and-timeoff.sql (it uses access_level / can_schedule).
-- Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
--
-- Who can use it: the Owner, Managers (staff-table Manager role or Manager-tier employees)
-- and Kitchen staff. Nobody else can read or change inventory.

create or replace function public.can_inventory() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.can_schedule() or public.staff_role() = 'kitchen', false)
$$;
revoke execute on function public.can_inventory() from anon;
grant execute on function public.can_inventory() to authenticated;

-- 1. The items you stock, per inventory
create table if not exists public.inventory_items (
  id         text primary key,
  category   text not null check (category in ('food', 'paper', 'bev')),
  section    text not null default '',      -- e.g. Produce, Protein / To-go / Red wine, Bourbon, Draught beer
  name       text not null,
  unit       text not null default '',      -- what you count in: case, lb, bottle, keg, each
  pack       text not null default '',      -- pack size or notes, e.g. 6/#10 cans, 750ml
  vendor     text not null default '',
  par        numeric,                       -- how many you want on hand
  cost       numeric,                       -- cost per counting unit
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inventory_items_cat on public.inventory_items (category, section, sort);

-- 2. Counts: one row per inventory per date; counts = { item id: amount on hand }
create table if not exists public.inventory_counts (
  id          text primary key,             -- '<category>:<YYYY-MM-DD>'
  category    text not null check (category in ('food', 'paper', 'bev')),
  count_date  date not null,
  counts      jsonb not null default '{}'::jsonb,
  counted_by  text not null default '',
  updated_at  timestamptz not null default now(),
  unique (category, count_date)
);

grant select, insert, update, delete on public.inventory_items to authenticated;
grant select, insert, update, delete on public.inventory_counts to authenticated;

alter table public.inventory_items enable row level security;
alter table public.inventory_counts enable row level security;

drop policy if exists "inventory team manages items" on public.inventory_items;
create policy "inventory team manages items" on public.inventory_items
  for all to authenticated using (public.can_inventory()) with check (public.can_inventory());

drop policy if exists "inventory team manages counts" on public.inventory_counts;
create policy "inventory team manages counts" on public.inventory_counts
  for all to authenticated using (public.can_inventory()) with check (public.can_inventory());

drop trigger if exists inventory_items_touch on public.inventory_items;
create trigger inventory_items_touch before update on public.inventory_items
  for each row execute function public.touch_row();
drop trigger if exists inventory_counts_touch on public.inventory_counts;
create trigger inventory_counts_touch before update on public.inventory_counts
  for each row execute function public.touch_row();
