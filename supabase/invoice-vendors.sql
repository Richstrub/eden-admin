-- Eden staff site: Inventory → ordered by the bottle or the case, and each vendor's delivery charges.
-- Run AFTER supabase/invoices.sql. Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
--
-- inventory_items.order_unit   how Eden orders it from the vendor: 'bottle', 'case' (or '' = not set). Filled in from invoices.
-- inventory_items.per_case     how many come in a case (6, 12…), so the order list can say "2 cases" for 12 bottles.
-- inventory_invoices.fees      delivery charges, fuel surcharges, deposits… from each invoice: [{ description, amount }]
-- inventory_invoices.fees_total  their sum, for the Vendors summary.

alter table public.inventory_items add column if not exists order_unit text not null default '';
alter table public.inventory_items add column if not exists per_case numeric;
alter table public.inventory_invoices add column if not exists fees jsonb not null default '[]'::jsonb;
alter table public.inventory_invoices add column if not exists fees_total numeric;
alter table public.inventory_invoices add column if not exists lines_total numeric;
create index if not exists inventory_invoices_vendor on public.inventory_invoices (lower(vendor), invoice_date desc);
