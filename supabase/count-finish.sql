-- Inventory counts that take more than one day: a count stays "in progress" until Save inventory is pressed.
-- finished_at is set when it's saved. Run once in Supabase → SQL Editor.
alter table public.inventory_counts add column if not exists finished_at timestamptz;

-- every count already in the system is treated as finished, except the beverage inventory started Nov 24, 2026
-- (still being counted: it stays open until Save inventory)
update public.inventory_counts set finished_at = updated_at
  where finished_at is null and not (category = 'bev' and count_date >= date '2026-11-24');
