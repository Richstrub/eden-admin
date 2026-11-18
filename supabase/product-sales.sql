-- Eden staff site: Financials → Product sales. Square "Item sales detail" CSVs, one row per day, item and variation,
-- and links from a Square item to what it uses (a recipe or an inventory item) for the weekly order guide.
-- Run AFTER supabase/payroll.sql and supabase/inventory.sql. Paste into Supabase > SQL Editor > New query and click Run.
-- Safe to run more than once.

create table if not exists public.sales_items (
  day        date not null,
  category   text not null default '',
  item       text not null,
  variation  text not null default '',
  qty        numeric not null default 0,
  gross      numeric not null default 0,
  discounts  numeric not null default 0,
  net        numeric not null default 0,
  file       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (day, category, item, variation)
);
create index if not exists sales_items_day on public.sales_items (day);

create table if not exists public.sales_item_links (
  key        text primary key,          -- category|item|variation, lower case
  kind       text not null,             -- 'recipe', 'inv' or 'skip'
  ref        text not null default '',  -- the recipe or inventory item id
  updated_at timestamptz not null default now()
);

alter table public.sales_items enable row level security;
alter table public.sales_item_links enable row level security;
revoke all on public.sales_items, public.sales_item_links from anon;
grant select, insert, update, delete on public.sales_items, public.sales_item_links to authenticated;

-- product sales are the Owner's (like the rest of Financials); the links are read by anyone who does inventory
drop policy if exists "owner" on public.sales_items;
create policy "owner" on public.sales_items for all to authenticated
  using (public.staff_role() = 'owner') with check (public.staff_role() = 'owner');
drop policy if exists "inventory" on public.sales_item_links;
create policy "inventory" on public.sales_item_links for all to authenticated
  using (public.can_inventory()) with check (public.can_inventory());
