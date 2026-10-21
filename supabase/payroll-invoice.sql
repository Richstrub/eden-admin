-- Eden staff site: the payroll company's invoice (Pinnacle Employee Services), estimated each week.
-- Run AFTER payroll.sql and payroll-square.sql. Paste into Supabase > SQL Editor > New query, click Run. Safe to run again.
--
-- payroll_settings.invoice holds the invoice rates (percentages of gross pay, and the flat weekly amounts),
-- first set from invoice 061939 (10/16/2026, pay period ending 10/11/2026). They can be changed in Payroll > Pay rates.
-- pay_rates.k401: the employee contributes to the 401(k), so the employer match applies to their pay.

create table if not exists public.payroll_settings (
  id          smallint primary key default 1 check (id = 1),
  invoice     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.payroll_settings enable row level security;
revoke all on public.payroll_settings from anon;
grant select, insert, update on public.payroll_settings to authenticated;
drop policy if exists "owner only" on public.payroll_settings;
create policy "owner only" on public.payroll_settings for all to authenticated
  using (public.staff_role() = 'owner') with check (public.staff_role() = 'owner');

insert into public.payroll_settings (id, invoice) values (1, jsonb_build_object(
  'fica', 7.65,        -- Social Security & Medicare, % of gross pay (tips included)
  'suta', 6.00,        -- NY state unemployment, % of each person's pay up to the yearly wage base (Pinnacle bills 6%)
  'sutaBase', 17600,   -- NY wage base for 2026, per person (raised every January)
  'futa', 0.60,        -- federal unemployment, % of each person's pay up to the federal wage base
  'futaBase', 7000,    -- federal wage base, per person
  'sdi', 0.60,         -- NY disability (SDI), % of gross
  'service', 1.80,     -- service fee, % of gross
  'k401', 3.00,        -- 401(k) match, % of pay for employees who contribute
  'benefits', 325.63,  -- benefits, $ a week
  'shipping', 10.00,   -- shipping, $ a week
  'source', 'Invoice 061939, 10/16/2026'
)) on conflict (id) do nothing;

alter table public.pay_rates add column if not exists k401 boolean not null default false;
update public.pay_rates set k401 = true
  where emp in (select id from public.employees where name ilike 'rich%strub%' or name ilike 'paige%' or name ilike 'michael%kw%');
insert into public.pay_rates (emp, k401)
  select id, true from public.employees e
  where (name ilike 'rich%strub%' or name ilike 'paige%' or name ilike 'michael%kw%') and not exists (select 1 from public.pay_rates p where p.emp = e.id)
  on conflict (emp) do nothing;
