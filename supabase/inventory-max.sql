-- Inventory: a maximum to keep on hand (over it → "use first"). Run once in Supabase → SQL Editor.
alter table public.inventory_items add column if not exists max_qty numeric;
