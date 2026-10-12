-- Eden staff site: Payroll (Owner only).
-- Weekly payroll, Sunday to Saturday: hours (filled from the published schedule, then corrected), overtime,
-- the week's tip pool split by hours among tip-pool staff, adjustments, and gross pay, for the accountant.
-- Pay rates and payroll are visible to the Owner only; managers and staff can't read them.
-- Run AFTER schedule.sql (and history.sql, so changes are recorded in History).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.

create table if not exists public.pay_rates (
  emp            uuid primary key references public.employees (id) on delete cascade,
  pay_type       text not null default 'hourly' check (pay_type in ('hourly', 'salary')),
  rate           numeric(8, 2),            -- dollars per hour (hourly)
  weekly_salary  numeric(10, 2),           -- dollars per week (salary)
  tip_eligible   boolean not null default false,
  notes          text not null default '',
  updated_at     timestamptz not null default now()
);

create table if not exists public.payroll_weeks (
  week_start    date primary key,          -- the Sunday that starts the pay week
  status        text not null default 'draft' check (status in ('draft', 'final')),
  tip_pool      numeric(10, 2) not null default 0,
  rows          jsonb not null default '{}'::jsonb,   -- { employee id: { hours: [Sun..Sat], adj, adj_note, snap (rates when finalized) } }
  notes         text not null default '',
  finalized_at  timestamptz,
  updated_at    timestamptz not null default now()
);

alter table public.pay_rates enable row level security;
alter table public.payroll_weeks enable row level security;
revoke all on public.pay_rates, public.payroll_weeks from anon;
grant select, insert, update, delete on public.pay_rates, public.payroll_weeks to authenticated;

drop policy if exists "owner only" on public.pay_rates;
create policy "owner only" on public.pay_rates for all to authenticated
  using (public.staff_role() = 'owner') with check (public.staff_role() = 'owner');
drop policy if exists "owner only" on public.payroll_weeks;
create policy "owner only" on public.payroll_weeks for all to authenticated
  using (public.staff_role() = 'owner') with check (public.staff_role() = 'owner');

create or replace function public.payroll_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists payroll_touch on public.pay_rates;
create trigger payroll_touch before update on public.pay_rates for each row execute function public.payroll_touch();
drop trigger if exists payroll_touch on public.payroll_weeks;
create trigger payroll_touch before update on public.payroll_weeks for each row execute function public.payroll_touch();

-- Record changes in History (if History is set up; History is Owner-only too). Pay amounts appear only there.
create or replace function public.payroll_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); em text := coalesce(auth.jwt() ->> 'email', '');
  j jsonb; o jsonb; k text; rkey text; lbl text; ch jsonb := '{}'::jsonb; whoname text; prev bigint; names text;
begin
  if uid is null or to_regclass('public.activity_log') is null then return null; end if;
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then o := to_jsonb(old); end if;
  if tg_table_name = 'pay_rates' then
    rkey := j ->> 'emp';
    lbl := 'Pay rate: ' || coalesce((select e.name from public.employees e where e.id::text = rkey), 'employee');
  else
    rkey := j ->> 'week_start';
    lbl := 'Payroll, week of ' || to_char((j ->> 'week_start')::date, 'Mon FMDD, YYYY');
  end if;
  if tg_op = 'UPDATE' then
    for k in select x from jsonb_object_keys(j) x loop
      if k in ('updated_at', 'rows') then continue; end if;
      if (j -> k) is distinct from (o -> k) then ch := ch || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', j -> k)); end if;
    end loop;
    if tg_table_name = 'payroll_weeks' and (j -> 'rows') is distinct from (o -> 'rows') then
      select string_agg(coalesce(e.name, 'employee'), ', ' order by e.name) into names
        from jsonb_object_keys(coalesce(j -> 'rows', '{}'::jsonb)) as kk(eid) left join public.employees e on e.id::text = kk.eid
        where (j -> 'rows' -> kk.eid) - 'snap' is distinct from (o -> 'rows' -> kk.eid) - 'snap';
      if names is not null then ch := ch || jsonb_build_object('hours or adjustments', jsonb_build_object('old', null, 'new', names)); end if;
    end if;
    if ch = '{}'::jsonb then return null; end if;
  end if;
  whoname := coalesce((select s.name from public.staff s where s.user_id = uid), nullif(em, ''), 'Owner');
  if tg_op = 'UPDATE' then   -- quick successive edits fold into one line, like the rest of History
    select a.id into prev from public.activity_log a
      where a.user_id = uid and a.tbl = tg_table_name and a.row_key = rkey and a.action = 'update' and a.at > now() - interval '10 minutes'
      order by a.at desc limit 1;
    if prev is not null then
      update public.activity_log a set at = now(), edits = a.edits + 1, label = lbl, new_row = j,
        changes = a.changes || coalesce((select jsonb_object_agg(x, jsonb_build_object('old', coalesce(a.changes -> x -> 'old', ch -> x -> 'old'), 'new', ch -> x -> 'new')) from jsonb_object_keys(ch) x), '{}'::jsonb)
        where a.id = prev;
      return null;
    end if;
  end if;
  insert into public.activity_log (user_id, email, who, action, tbl, row_key, label, changes, old_row, new_row)
  values (uid, em, whoname, lower(tg_op), tg_table_name, rkey, lbl, ch,
          case when tg_op = 'INSERT' then null when tg_op = 'DELETE' then j else o end,
          case when tg_op = 'DELETE' then null else j end);
  return null;
end $$;
revoke all on function public.payroll_log() from public, anon, authenticated;

drop trigger if exists log_activity on public.pay_rates;
drop trigger if exists log_activity on public.payroll_weeks;
drop trigger if exists payroll_log on public.pay_rates;
create trigger payroll_log after insert or update or delete on public.pay_rates for each row execute function public.payroll_log();
drop trigger if exists payroll_log on public.payroll_weeks;
create trigger payroll_log after insert or update or delete on public.payroll_weeks for each row execute function public.payroll_log();
