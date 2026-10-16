-- Eden staff site: time off on the calendar.
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once. Needs access-and-timeoff.sql.
-- The calendar (staff site, staff page and the Hub) shows who is off: approved time off for everyone on the team,
-- plus requests still waiting for a decision for the Owner and managers. Only names, dates and times are shared;
-- the reason is shown to the Owner and managers only. Denied requests never show.
create or replace function public.calendar_time_off(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare lvl text := coalesce(public.access_level(), ''); mgr boolean := lvl in ('owner', 'manager');
begin
  if lvl not in ('owner', 'manager', 'employee') then return '[]'::jsonb; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', coalesce(nullif(trim(e.name), ''), 'Team member'), 'position', coalesce(e.position, ''),
      'start_date', t.start_date, 'end_date', t.end_date, 'all_day', t.all_day, 'start_time', t.start_time, 'end_time', t.end_time,
      'status', t.status, 'reason', case when mgr then t.reason else '' end) order by t.start_date, e.name)
    from public.time_off t join public.employees e on e.id = t.emp
    where t.start_date <= p_to and t.end_date >= p_from
      and (t.status = 'approved' or (mgr and t.status = 'pending'))), '[]'::jsonb);
end $$;
revoke all on function public.calendar_time_off(date, date) from public, anon;
grant execute on function public.calendar_time_off(date, date) to authenticated;
