-- Eden staff page: show coworkers' full names on the schedule (instead of first name + last initial).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
-- Still shares only name, position and shift times: no phone numbers or emails.
create or replace function public.team_schedule(p_week date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w public.schedule_weeks%rowtype; me uuid; res jsonb;
begin
  if not public.is_team() then raise exception 'not on the staff list' using errcode = '42501'; end if;
  me := public.my_employee_id();
  select * into w from public.schedule_weeks where week_start = p_week and status = 'published';
  if not found then
    return jsonb_build_object('week_start', p_week, 'published', false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', coalesce(nullif(trim(e.name), ''), 'Team member'),
      'position', coalesce(e.position, ''),
      'mine', me is not null and (s ->> 'emp') = me::text,
      'day', (s ->> 'day')::int,
      'start', s ->> 'start',
      'end', s ->> 'end',
      'role', coalesce(s ->> 'role', ''),
      'note', coalesce(s ->> 'note', ''))
      order by (s ->> 'day')::int, s ->> 'start'), '[]'::jsonb)
    into res
  from jsonb_array_elements(coalesce(w.published, '[]'::jsonb)) s
  left join public.employees e on e.id::text = s ->> 'emp';
  return jsonb_build_object('week_start', p_week, 'published', true, 'published_at', w.published_at, 'shifts', res);
end $$;
revoke execute on function public.team_schedule(date) from anon;
grant execute on function public.team_schedule(date) to authenticated;
