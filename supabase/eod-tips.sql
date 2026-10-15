-- Eden staff site: nightly tips on the End of day report.
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once. Needs eod-reports.sql first.
--
-- The report gets cash tips, credit card tips and the tip-pool staff who worked (with their hours). The pool is split
-- by hours: each person's share = their hours ÷ everyone's hours × the pool, cash and card kept separate.
-- When the report is submitted, the staff site's worker emails each person their share (to the email on their login)
-- and sends the Owner a copy with everyone's shares.
--
-- Who is in the tip pool: the people ticked "Tip pool" in Payroll > Pay rates. Until anyone is ticked there,
-- employees whose access is Server or Bartender. The manager can add or remove people on the report.

alter table public.eod_reports add column if not exists tips_cash  numeric(10,2) check (tips_cash >= 0);
alter table public.eod_reports add column if not exists tips_card  numeric(10,2) check (tips_card >= 0);
alter table public.eod_reports add column if not exists tip_staff  jsonb not null default '[]'::jsonb;   -- [{emp, name, hours}]
alter table public.eod_reports add column if not exists tips_sent_at timestamptz;
alter table public.eod_reports add column if not exists tips_sent  jsonb not null default '[]'::jsonb;   -- [{name, email, ok, error}] from the last send

-- Sending the tip emails stamps the report; that alone doesn't count as "changed after submitting".
create or replace function public.eod_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.title := 'End of day report · ' || to_char(new.report_date, 'Dy Mon FMDD, YYYY') || ' · ' ||
    case new.shift when 'dinner' then 'Dinner' when 'private' then 'Private event' else 'Dinner and private event' end;
  if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.submitted_at is not distinct from old.submitted_at
     and (to_jsonb(new) - array['updated_at', 'tips_sent_at', 'tips_sent', 'edited_after_submit_at', 'edited_after_submit_by'])
         is distinct from (to_jsonb(old) - array['updated_at', 'tips_sent_at', 'tips_sent', 'edited_after_submit_at', 'edited_after_submit_by']) then
    new.edited_after_submit_at := now();
  end if;
  return new;
end $$;

-- Hours of one shift from the schedule: 'HH:MM' start to 'HH:MM' or a cut (1st cut ~8pm, 2nd cut ~9pm, close ~10pm).
create or replace function public.eod_shift_hours(p_start text, p_end text) returns numeric
language sql immutable as $$
  select case when coalesce(p_start, '') !~ '^\d{1,2}:\d{2}' then 0 else greatest(0, round((
    extract(epoch from (case p_end when 'cut1' then '20:00' when 'cut2' then '21:00' when 'close' then '22:00' else coalesce(nullif(p_end, ''), '22:00') end)::time)
    - extract(epoch from p_start::time)) / 3600.0, 2)) end
$$;

-- For the report: the tip-pool staff on the published schedule that day (with their scheduled hours),
-- and everyone else who could be added. Owner and managers only. Says who has no email on file.
create or replace function public.eod_tip_staff(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ws date := p_date - extract(dow from p_date)::int; sh jsonb; by_rates boolean := false; tipped uuid[] := '{}'; out jsonb;
begin
  if coalesce(public.access_level(), '') not in ('owner', 'manager') then return jsonb_build_object('error', 'denied'); end if;
  if to_regclass('public.pay_rates') is not null then   -- Payroll > Pay rates "Tip pool", if Payroll is set up
    execute 'select coalesce(array_agg(emp), ''{}'') from public.pay_rates where tip_eligible' into tipped;
    by_rates := cardinality(tipped) > 0;
  end if;
  if to_regclass('public.schedule_weeks') is not null then
    execute 'select w.published from public.schedule_weeks w where w.week_start = $1 and w.status = ''published''' into sh using ws;
  end if;
  with pool as (
    select e.id, e.name, e.email, e.position, e.access, e.active,
      case when by_rates then e.id = any (tipped)
           else e.access in ('server', 'bartender') end as in_pool
    from public.employees e
  ), hrs as (
    select (s ->> 'emp')::uuid as emp, sum(public.eod_shift_hours(s ->> 'start', s ->> 'end')) as hours
    from jsonb_array_elements(coalesce(sh, '[]'::jsonb)) s
    where (s ->> 'day')::int = extract(dow from p_date)::int and coalesce(s ->> 'emp', '') ~ '^[0-9a-f-]{36}$'
    group by 1
  )
  select jsonb_build_object(
    'posted', sh is not null, 'by_rates', by_rates,
    'staff', coalesce((select jsonb_agg(jsonb_build_object('emp', p.id, 'name', p.name, 'hours', h.hours, 'email', p.email <> '') order by p.name)
       from pool p join hrs h on h.emp = p.id where p.in_pool and h.hours > 0), '[]'::jsonb),
    'everyone', coalesce((select jsonb_agg(jsonb_build_object('emp', p.id, 'name', p.name, 'position', p.position, 'email', p.email <> '', 'pool', p.in_pool) order by p.name)
       from pool p where p.active and p.name <> ''), '[]'::jsonb)) into out;
  return out;
end $$;
revoke all on function public.eod_tip_staff(date) from public, anon;
grant execute on function public.eod_tip_staff(date) to authenticated;

-- For the worker that sends the tip emails: the report's tips with each person's email. Owner and managers only.
create or replace function public.eod_tip_mail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.eod_reports;
begin
  if coalesce(public.access_level(), '') not in ('owner', 'manager') then return jsonb_build_object('error', 'denied'); end if;
  select * into r from public.eod_reports where id = p_id;
  if r.id is null then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('id', r.id, 'report_date', r.report_date, 'shift', r.shift, 'status', r.status, 'prepared_by', r.prepared_by,
    'tips_cash', coalesce(r.tips_cash, 0), 'tips_card', coalesce(r.tips_card, 0),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('emp', t ->> 'emp', 'name', coalesce(nullif(trim(e.name), ''), t ->> 'name'),
        'email', coalesce(e.email, ''), 'hours', coalesce((t ->> 'hours')::numeric, 0)) order by coalesce(e.name, t ->> 'name'))
      from jsonb_array_elements(r.tip_staff) t left join public.employees e on e.id::text = t ->> 'emp'
      where coalesce((t ->> 'hours')::numeric, 0) > 0), '[]'::jsonb));
end $$;
revoke all on function public.eod_tip_mail(uuid) from public, anon;
grant execute on function public.eod_tip_mail(uuid) to authenticated;
