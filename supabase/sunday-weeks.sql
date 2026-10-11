-- Eden schedule: move any schedules saved with Monday-start weeks to Sunday-start weeks.
-- Run ONCE after the update that makes weeks start on Sunday. Safe to run again (it only touches
-- weeks that still start on a Monday). Paste into Supabase > SQL Editor > New query, click Run.
do $$
declare r record; s jsonb; d date; ws date; nd int;
begin
  for r in select * from public.schedule_weeks where extract(dow from week_start) = 1 loop
    -- working copy
    for s in select value from jsonb_array_elements(coalesce(r.shifts, '[]'::jsonb)) loop
      d := r.week_start + (s ->> 'day')::int; nd := extract(dow from d)::int; ws := d - nd;
      insert into public.schedule_weeks (week_start, shifts, status) values (ws, '[]'::jsonb, 'draft') on conflict (week_start) do nothing;
      update public.schedule_weeks set shifts = coalesce(shifts, '[]'::jsonb) || jsonb_build_array(jsonb_set(s, '{day}', to_jsonb(nd))) where week_start = ws;
    end loop;
    -- what employees see (the published copy)
    if r.status = 'published' then
      for s in select value from jsonb_array_elements(coalesce(r.published, '[]'::jsonb)) loop
        d := r.week_start + (s ->> 'day')::int; nd := extract(dow from d)::int; ws := d - nd;
        insert into public.schedule_weeks (week_start, shifts, status) values (ws, '[]'::jsonb, 'draft') on conflict (week_start) do nothing;
        update public.schedule_weeks set published = coalesce(published, '[]'::jsonb) || jsonb_build_array(jsonb_set(s, '{day}', to_jsonb(nd))),
          status = 'published', published_at = coalesce(published_at, r.published_at) where week_start = ws;
      end loop;
    end if;
    delete from public.schedule_weeks where week_start = r.week_start;
  end loop;
end $$;
