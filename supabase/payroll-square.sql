-- Eden staff site: Payroll from Square timecards, daily tip pools, kitchen hours and commission.
-- Run AFTER payroll.sql. Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- Adds to Pay rates:
--   kitchen_rate  a second hourly rate for kitchen hours (Tyler: $30/hr), entered on their timesheet as "Kitchen"
--   commission    paid on commission as well (Keenan): a weekly commission amount on the timesheet
--   payroll_id    the payroll company's Employee ID (e.g. K15347), for the Eden Hospitality Hours sheet
--   payroll_name  the name exactly as the payroll company spells it (e.g. "Ball, Tyler")
--   square_name   the name as it appears in Square's timecard export, when it differs from the staff site

alter table public.pay_rates add column if not exists kitchen_rate numeric(8, 2);
alter table public.pay_rates add column if not exists commission   boolean not null default false;
alter table public.pay_rates add column if not exists payroll_id   text not null default '';
alter table public.pay_rates add column if not exists payroll_name text not null default '';
alter table public.pay_rates add column if not exists square_name  text not null default '';

-- Tyler Ball: not in the tip pool; front of house at his regular rate, kitchen hours at $30/hr
insert into public.pay_rates (emp, kitchen_rate, tip_eligible)
  select id, 30, false from public.employees where name ilike 'tyler%ball%'
  on conflict (emp) do update set kitchen_rate = coalesce(public.pay_rates.kitchen_rate, 30), tip_eligible = false;

-- Keenan Davis: commission and tips
insert into public.pay_rates (emp, commission, tip_eligible)
  select id, true, true from public.employees where name ilike 'keenan%'
  on conflict (emp) do update set commission = true, tip_eligible = true;
