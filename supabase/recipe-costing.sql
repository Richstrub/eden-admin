-- Eden staff site: recipe costs and Menu costs.
-- Run AFTER supabase/recipes.sql. Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
--
-- recipes.menu_links  the menu items a recipe goes into, and how much of it goes on one plate:
--                     [{ tab, name, desc, qty, unit }]  e.g. 1 portion of Short Rib, 2 oz of Salsa Verde.
-- (Each ingredient's inventory item is kept inside recipes.ingredients as inv_id, or rec_id for another recipe.)
alter table public.recipes add column if not exists menu_links jsonb not null default '[]'::jsonb;
