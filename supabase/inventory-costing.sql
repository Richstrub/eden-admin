-- Eden staff site: Inventory → menu prices, cost %, pour sizes and price-change alerts.
-- Run AFTER supabase/invoices.sql. Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
--
-- inventory_items.menu_refs   which menu items an inventory item is sold as: [{ "tab": "m-wine", "name": "…" }, …].
--                             Empty = matched to the menu by name automatically.
-- inventory_settings          pour sizes for cost %: wine by the glass (5 oz) and spirits (1.5 oz, the base spirit in a cocktail).
-- inventory_prices.seen_at    when a price change from an invoice was looked at (Inventory → Price changes). Empty = still an alert.

alter table public.inventory_items add column if not exists menu_refs jsonb not null default '[]'::jsonb;
alter table public.inventory_prices add column if not exists seen_at timestamptz;

create table if not exists public.inventory_settings (
  id          int primary key default 1 check (id = 1),
  glass_oz    numeric not null default 5,       -- wine by the glass
  pour_oz     numeric not null default 1.5,     -- spirits: the base spirit in a cocktail, and spirits on the list
  draught_oz  numeric not null default 16,      -- a pint of draught beer
  keg_oz      numeric not null default 661,     -- a sixth-barrel keg (5.16 gal); a half barrel is 1984
  updated_at  timestamptz not null default now()
);
insert into public.inventory_settings (id) values (1) on conflict (id) do nothing;
alter table public.inventory_settings enable row level security;
revoke all on public.inventory_settings from anon;
grant select, update on public.inventory_settings to authenticated;
drop policy if exists "inventory reads" on public.inventory_settings;
create policy "inventory reads" on public.inventory_settings for select to authenticated using (public.can_inventory());
drop policy if exists "owner and managers change" on public.inventory_settings;
create policy "owner and managers change" on public.inventory_settings for update to authenticated
  using (public.access_level() in ('owner', 'manager')) with check (public.access_level() in ('owner', 'manager'));
