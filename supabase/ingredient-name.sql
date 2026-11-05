-- Eden staff site: Inventory → Ingredient name for food items ("Edible flowers" for "100pc ed. flowers").
-- Recipes search the inventory by this name. Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
alter table public.inventory_items add column if not exists ingredient text not null default '';
