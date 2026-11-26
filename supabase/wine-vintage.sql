-- Inventory: a new vintage waiting to replace an older one. On the new bottle, "replaces" holds the old bottle's id.
-- When the old vintage runs out, the staff site says to switch the wine list. Run once in Supabase → SQL Editor.
alter table public.inventory_items add column if not exists replaces text;
