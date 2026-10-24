-- Eden staff site: cooler and freezer temperatures (Elitech RCW-800W WiFi data loggers).
-- Run AFTER supabase/permissions.sql (it uses can_prep / can_schedule) and inquiries.sql (inquiry_key_ok).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- temp_units     each cooler or freezer: its name, safe range (°F) and the Elitech logger's serial / GUID
-- temp_readings  one row per reading: from Elitech's cloud (every few minutes), an export file dropped on the page,
--                or a reading typed in by hand (with who took it)
-- temp_notes     corrective actions written against a unit and time ("moved product to walk-in, called repair")
-- Who can see it: the Owner, managers and kitchen staff (the same people as the Prep List).
-- Managers and the Owner add units and change their limits; anyone who can see it can log a reading or a note.

create or replace function public.can_temps() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.can_prep(), false)
$$;
revoke execute on function public.can_temps() from anon;
grant execute on function public.can_temps() to authenticated;

create table if not exists public.temp_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'cooler' check (kind in ('cooler', 'freezer', 'other')),
  min_f       numeric(5,1),                 -- lowest safe temperature (°F); blank = no lower limit
  max_f       numeric(5,1),                 -- highest safe temperature (°F): 41 for coolers, 0 for freezers
  grace_min   integer not null default 30,  -- only flag it once it has been out of range this long (door openings, defrost)
  serial      text not null default '',     -- the logger's serial number or GUID, as Elitech's cloud reports it
  sort        integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists temp_units_serial on public.temp_units (lower(serial)) where serial <> '';

create table if not exists public.temp_readings (
  unit_id   uuid not null references public.temp_units (id) on delete cascade,
  at        timestamptz not null,
  temp_f    numeric(6,2) not null,
  humidity  numeric(5,1),
  source    text not null default 'elitech' check (source in ('elitech', 'file', 'manual')),
  by_name   text not null default '',
  primary key (unit_id, at, source)
);
create index if not exists temp_readings_at on public.temp_readings (at);

create table if not exists public.temp_notes (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid references public.temp_units (id) on delete cascade,
  at          timestamptz not null default now(),   -- the time the note is about
  note        text not null,
  by_name     text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists temp_notes_at on public.temp_notes (at);

-- the live feed's last check-in (one row): when, any error, and loggers it saw that aren't set up as units yet
create table if not exists public.temp_feed (
  id        smallint primary key default 1 check (id = 1),
  at        timestamptz,
  error     text not null default '',
  devices   jsonb not null default '[]'::jsonb
);
insert into public.temp_feed (id) values (1) on conflict (id) do nothing;

alter table public.temp_units enable row level security;
alter table public.temp_readings enable row level security;
alter table public.temp_notes enable row level security;
alter table public.temp_feed enable row level security;
revoke all on public.temp_units, public.temp_readings, public.temp_notes, public.temp_feed from anon;
grant select, insert, update, delete on public.temp_units to authenticated;
grant select, insert, update on public.temp_readings to authenticated;
grant select, insert, update, delete on public.temp_notes to authenticated;
grant select on public.temp_feed to authenticated;

drop policy if exists "read" on public.temp_units;
create policy "read" on public.temp_units for select to authenticated using (public.can_temps());
drop policy if exists "managers change" on public.temp_units;
create policy "managers change" on public.temp_units for all to authenticated using (public.can_schedule()) with check (public.can_schedule());

drop policy if exists "read" on public.temp_readings;
create policy "read" on public.temp_readings for select to authenticated using (public.can_temps());
drop policy if exists "add" on public.temp_readings;
create policy "add" on public.temp_readings for insert to authenticated with check (public.can_temps() and source in ('file', 'manual'));
drop policy if exists "fix" on public.temp_readings;
create policy "fix" on public.temp_readings for update to authenticated using (public.can_temps() and source in ('file', 'manual')) with check (public.can_temps() and source in ('file', 'manual'));

drop policy if exists "read" on public.temp_notes;
create policy "read" on public.temp_notes for select to authenticated using (public.can_temps());
drop policy if exists "write" on public.temp_notes;
create policy "write" on public.temp_notes for all to authenticated using (public.can_temps()) with check (public.can_temps());

drop policy if exists "read" on public.temp_feed;
create policy "read" on public.temp_feed for select to authenticated using (public.can_temps());

-- Readings for the page, already boiled down so a month of 5-minute readings comes back small:
-- { units: { id: [[bucket start (epoch s), min, max, avg], ...] }, latest: { id: { at, temp_f, humidity, source } } }
create or replace function public.temp_series(p_from timestamptz, p_to timestamptz, p_bucket_min integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b integer := greatest(coalesce(p_bucket_min, 15), 1) * 60; res jsonb;
begin
  if not public.can_temps() then return jsonb_build_object('error', 'denied'); end if;
  select jsonb_build_object(
    'units', coalesce((select jsonb_object_agg(unit_id, pts) from (
        select unit_id, jsonb_agg(jsonb_build_array(t, mn, mx, av) order by t) pts from (
          select unit_id, (floor(extract(epoch from at) / b) * b)::bigint t, min(temp_f) mn, max(temp_f) mx, round(avg(temp_f), 2) av
          from public.temp_readings where at >= p_from and at < p_to group by 1, 2) q group by unit_id) s), '{}'::jsonb),
    'latest', coalesce((select jsonb_object_agg(unit_id, jsonb_build_object('at', at, 'temp_f', temp_f, 'humidity', humidity, 'source', source)) from (
        select distinct on (unit_id) unit_id, at, temp_f, humidity, source from public.temp_readings
        where at > now() - interval '30 days' order by unit_id, at desc) l), '{}'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.temp_series(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.temp_series(timestamptz, timestamptz, integer) to authenticated;

-- The staff site's worker (every 5 minutes) hands over what Elitech's cloud reported.
-- p_rows: [{ serial, name, at, temp_f, humidity }]. Readings from loggers not set up yet are kept in temp_feed.devices
-- so a manager can add them as units with one click.
create or replace function public.temp_ingest_server(p_key text, p_rows jsonb, p_error text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer := 0; seen jsonb;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  insert into public.temp_readings (unit_id, at, temp_f, humidity, source)
    select u.id, (r->>'at')::timestamptz, (r->>'temp_f')::numeric, nullif(r->>'humidity', '')::numeric, 'elitech'
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    join public.temp_units u on u.serial <> '' and lower(u.serial) = lower(r->>'serial')
    where r->>'temp_f' is not null and r->>'at' is not null
    on conflict (unit_id, at, source) do nothing;
  get diagnostics n = row_count;
  select coalesce(jsonb_agg(distinct jsonb_build_object('serial', r->>'serial', 'name', coalesce(r->>'name', ''), 'temp_f', r->'temp_f')), '[]'::jsonb) into seen
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where not exists (select 1 from public.temp_units u where u.serial <> '' and lower(u.serial) = lower(r->>'serial'));
  update public.temp_feed set at = now(), error = coalesce(p_error, ''), devices = seen where id = 1;
  return jsonb_build_object('ok', true, 'saved', n);
end $$;
revoke all on function public.temp_ingest_server(text, jsonb, text) from public, authenticated;
grant execute on function public.temp_ingest_server(text, jsonb, text) to anon;

-- the loggers' serials / GUIDs the worker should ask Elitech's cloud about
create or replace function public.temp_serials_server(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  return coalesce((select jsonb_agg(serial) from public.temp_units where serial <> '' and active), '[]'::jsonb);
end $$;
revoke all on function public.temp_serials_server(text) from public, authenticated;
grant execute on function public.temp_serials_server(text) to anon;

-- units the ROP HACCP plan tracks (the freezer and the protein cooler): ticked under Temperatures > Set up
alter table public.temp_units add column if not exists rop boolean not null default false;

-- No duplicate readings. A logger reading (from Elitech's cloud or an export file) is skipped, not saved, when the same
-- unit already has a logger reading within 2 minutes of it, from either source. Re-adding a file, overlapping export
-- dates, or a file covering hours the live feed already saved adds nothing. Readings typed in by hand are always kept.
create or replace function public.temp_readings_skip_dupes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'manual' then return new; end if;
  if exists (select 1 from public.temp_readings r
             where r.unit_id = new.unit_id and r.source <> 'manual'
               and r.at > new.at - interval '2 minutes' and r.at < new.at + interval '2 minutes') then
    return null;   -- already have it: skip quietly
  end if;
  return new;
end $$;
drop trigger if exists temp_readings_skip_dupes on public.temp_readings;
create trigger temp_readings_skip_dupes before insert on public.temp_readings
  for each row execute function public.temp_readings_skip_dupes();

-- one-time clean-up of any duplicates already saved: keeps the earliest logger reading in each 2-minute window
delete from public.temp_readings b
 using public.temp_readings a
 where a.unit_id = b.unit_id and a.source <> 'manual' and b.source <> 'manual'
   and a.at > b.at - interval '2 minutes' and a.at <= b.at
   and (a.at < b.at or a.source < b.source);
