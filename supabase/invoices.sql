-- Eden staff site: Inventory → Scan invoice.
-- Run AFTER supabase/inventory.sql. Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
--
-- inventory_invoices     every invoice whose prices were put into the inventory (vendor, number, date, its lines)
-- inventory_item_links   what Eden has confirmed: this vendor's item (by its code, or its description) is this inventory item,
--                        and how many of the item's counting units come in one invoice unit (6 cans in a case = 6)
-- inventory_prices       price history: each confirmed line's new cost per counting unit
-- Same people as the inventory: the Owner, Managers and Kitchen staff.

create table if not exists public.inventory_invoices (
  id           uuid primary key default gen_random_uuid(),
  vendor       text not null default '',
  invoice_no   text not null default '',
  invoice_date date,
  total        numeric,
  lines        jsonb not null default '[]'::jsonb,
  source       text not null default '',          -- 'photo', 'pdf' or 'csv', and the file name
  created_by   text not null default '',
  created_at   timestamptz not null default now()
);

create table if not exists public.inventory_item_links (
  vendor_key  text not null,                      -- vendor name, lower case
  line_key    text not null,                      -- 'code:<vendor item code>' or 'desc:<description, lower case>'
  item_id     text not null references public.inventory_items (id) on delete cascade,
  per_unit    numeric not null default 1,         -- counting units in one invoice unit
  updated_at  timestamptz not null default now(),
  primary key (vendor_key, line_key)
);

create table if not exists public.inventory_prices (
  id            uuid primary key default gen_random_uuid(),
  item_id       text not null references public.inventory_items (id) on delete cascade,
  invoice_id    uuid references public.inventory_invoices (id) on delete set null,
  price_date    date not null default current_date,
  vendor        text not null default '',
  invoice_line  text not null default '',
  invoice_price numeric,                          -- price per invoice unit
  invoice_unit  text not null default '',
  per_unit      numeric,
  unit_cost     numeric,                          -- what went into the inventory: cost per counting unit
  old_cost      numeric,
  created_at    timestamptz not null default now()
);
create index if not exists inventory_prices_item on public.inventory_prices (item_id, price_date desc);

alter table public.inventory_invoices enable row level security;
alter table public.inventory_item_links enable row level security;
alter table public.inventory_prices enable row level security;
revoke all on public.inventory_invoices, public.inventory_item_links, public.inventory_prices from anon;
grant select, insert, update, delete on public.inventory_invoices, public.inventory_item_links, public.inventory_prices to authenticated;
drop policy if exists "inventory" on public.inventory_invoices;
create policy "inventory" on public.inventory_invoices for all to authenticated using (public.can_inventory()) with check (public.can_inventory());
drop policy if exists "inventory" on public.inventory_item_links;
create policy "inventory" on public.inventory_item_links for all to authenticated using (public.can_inventory()) with check (public.can_inventory());
drop policy if exists "inventory" on public.inventory_prices;
create policy "inventory" on public.inventory_prices for all to authenticated using (public.can_inventory()) with check (public.can_inventory());
