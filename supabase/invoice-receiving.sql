-- Eden staff site: Inventory → Scan invoice remembers how each vendor's line was received.
-- Run AFTER supabase/invoices.sql. Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
--
-- inventory_item_links.recv  what was set when the line was last checked: the unit it came in, the case or bottle size,
--                            bottles per case, keg size, and the unit a food item is counted in
--                            ({ unit, pack, bpc, ml, set_unit, keg, rcv_unit }). The next invoice from that vendor starts out the same way.
alter table public.inventory_item_links add column if not exists recv jsonb;
