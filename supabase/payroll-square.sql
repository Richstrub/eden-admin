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

-- Tyler Ball: two Square profiles. "Tyler Ball" is his tip-pool hours; "Tyler J Ball" is hours outside the tip pool
-- at his regular rate. Kitchen hours (added on his timesheet) are at $30/hr.
insert into public.pay_rates (emp, kitchen_rate, tip_eligible, square_name)
  select id, 30, true, 'Tyler Ball; Tyler J Ball=notip' from public.employees where name ilike 'tyler%ball%'
  on conflict (emp) do update set kitchen_rate = coalesce(public.pay_rates.kitchen_rate, 30), tip_eligible = true,
    square_name = case when public.pay_rates.square_name = '' then excluded.square_name else public.pay_rates.square_name end;

-- Keenan Davis: commission is his base pay (hourly rate $0); his hours count toward the tip pool
insert into public.pay_rates (emp, pay_type, rate, commission, tip_eligible)
  select id, 'hourly', 0, true, true from public.employees where name ilike 'keenan%'
  on conflict (emp) do update set pay_type = 'hourly', rate = 0, commission = true, tip_eligible = true;

-- Rich Strub: salary, $1,442.31 a week
insert into public.pay_rates (emp, pay_type, weekly_salary, tip_eligible)
  select id, 'salary', 1442.31, false from public.employees where name ilike 'rich%strub%'
  on conflict (emp) do update set pay_type = 'salary', weekly_salary = 1442.31, tip_eligible = false;
