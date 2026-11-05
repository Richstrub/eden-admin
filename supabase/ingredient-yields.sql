-- Eden staff site: Menu costs → Ingredient yields (egg whites & yolks from whole eggs, lemon & lime juice from whole fruit).
-- Run AFTER supabase/inventory-costing.sql. Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
-- Empty = use the built-in defaults (large egg white 33 g, yolk 17 g; juice of 1 lemon 48 g, 1 lime 44 g).
alter table public.inventory_settings add column if not exists yields jsonb not null default '[]'::jsonb;
