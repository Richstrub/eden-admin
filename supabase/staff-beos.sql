-- Eden staff site: BEOs for the team, without prices.
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once. Needs inquiries.sql and hub.sql.
-- The staff page (phones) and the Hub show upcoming events' BEOs as the front-of-house service sheet and the kitchen
-- production sheet: timeline, room setup, menu, counts, dietary needs, beverage service and notes. Prices, billing,
-- deposits and the client's email and billing address are taken out here in the database, so they never reach staff.
-- The Owner and managers (including staff whose access is Manager) get the whole BEO, so they also see the pricing.
-- The Hub is a shared screen, so it always gets the version without prices.

-- the BEO with everything about money (and the client's billing contact) removed
create or replace function public.beo_strip(d jsonb) returns jsonb
language sql immutable as $$
  select coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(d, '{}'::jsonb)) x(k, v)
    where k !~ '^bill\.' and k !~ '\.(price|total)$' and k not in ('__src', 'ev.email', 'ev.address', 'ev.waive')), '{}'::jsonb)
$$;

create or replace function public.staff_beo_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() in ('owner', 'manager', 'hub'), false) or coalesce(public.is_team(), false) or coalesce(public.can_schedule(), false)
$$;

-- upcoming events with a BEO (from yesterday on), soonest first
create or replace function public.staff_beo_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'America/New_York')::date;
begin
  if not public.staff_beo_ok() then return jsonb_build_object('error', 'not_allowed'); end if;
  return jsonb_build_object('beos', coalesce((select jsonb_agg(x order by x ->> 'date', x ->> 'start') from (
    select jsonb_build_object('id', q.id,
      'name', coalesce(nullif(q.beo_doc ->> 'ev.name', ''), nullif(q.event_name, ''), 'Event'),
      'date', coalesce(nullif(q.beo_doc ->> 'ev.date', ''), q.event_date::text),
      'start', coalesce(nullif(q.beo_doc ->> 'ev.start', ''), q.start_time),
      'end', coalesce(nullif(q.beo_doc ->> 'ev.end', ''), q.end_time),
      'room', coalesce(nullif(case when q.beo_doc ->> 'ev.room' = 'Other' then q.beo_doc ->> 'ev.roomAddr' else q.beo_doc ->> 'ev.room' end, ''), q.location),
      'guests', coalesce(nullif(q.beo_doc ->> 'ev.guar', ''), nullif(q.beo_doc ->> 'ev.expected', ''), q.guests::text),
      'final', coalesce(q.beo_doc ->> 'ev.guar', '') <> '',
      'status', q.status) as x
    from public.catering_inquiries q
    where q.status in ('beo', 'completed') and q.beo_doc is not null
      and coalesce(nullif(q.beo_doc ->> 'ev.date', '')::date, q.event_date) >= today - 1
    limit 60) s), '[]'::jsonb));
end $$;

-- one BEO, ready for the staff sheets
create or replace function public.staff_beo_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q public.catering_inquiries;
begin
  if not public.staff_beo_ok() then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into q from public.catering_inquiries where id = p_id and status in ('beo', 'completed') and beo_doc is not null;
  if q.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if coalesce(public.staff_role() = 'hub', false) or not coalesce(public.can_schedule(), false) then
    return jsonb_build_object('id', q.id, 'doc', public.beo_strip(q.beo_doc), 'prices', false, 'updated', q.updated_at);
  end if;
  return jsonb_build_object('id', q.id, 'doc', q.beo_doc, 'prices', true, 'updated', q.updated_at);
end $$;

revoke all on function public.staff_beo_list() from public, anon;
revoke all on function public.staff_beo_get(uuid) from public, anon;
revoke all on function public.staff_beo_ok() from public, anon;
grant execute on function public.staff_beo_list() to authenticated;
grant execute on function public.staff_beo_get(uuid) to authenticated;
