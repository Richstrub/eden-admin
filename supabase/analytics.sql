-- Eden staff site: Analytics > Website traffic.
-- Visits to the public website (edencny.com) are counted by the staff site's small web worker
-- (worker.js in this repository) and stored here: which page, when, roughly where from (country,
-- state/region and city, as worked out by Cloudflare), how they found the site, and the kind of device.
-- No names, no IP addresses and no cookies are stored. A visitor is an anonymous code that changes
-- every day, so one person browsing on one day counts once.
-- Only the Owner can read it.
-- Run AFTER schedule.sql (it uses staff_role()). Paste into Supabase > SQL Editor > New query, click Run.
-- Safe to run more than once.

create table if not exists public.page_views (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  path     text not null default '/',
  host     text not null default '',   -- which address of the site (edencny.com, www.edencny.com, …)
  referrer text not null default '',   -- the site they came from (just its name, e.g. google.com)
  source   text not null default '',   -- utm_source from a tagged link (instagram, newsletter, …)
  medium   text not null default '',
  campaign text not null default '',
  country  text not null default '',   -- two-letter country code
  region   text not null default '',   -- state / province
  city     text not null default '',
  lat      real,                       -- approximate (city level)
  lon      real,
  device   text not null default '',   -- mobile, tablet, desktop
  browser  text not null default '',
  visitor  text not null default '',   -- anonymous daily code
  constraint page_views_sizes check (
    length(path) <= 300 and length(host) <= 120 and length(referrer) <= 200 and length(source) <= 100 and
    length(medium) <= 100 and length(campaign) <= 150 and length(country) <= 2 and length(region) <= 100 and
    length(city) <= 100 and length(device) <= 20 and length(browser) <= 40 and length(visitor) <= 64 and
    (lat is null or lat between -90 and 90) and (lon is null or lon between -180 and 180))
);
create index if not exists page_views_at on public.page_views (at desc);

alter table public.page_views enable row level security;
-- the worker adds visits using the public (publishable) key; nobody but the Owner can read them
grant insert on public.page_views to anon, authenticated;
grant usage on sequence public.page_views_id_seq to anon, authenticated;
grant select on public.page_views to authenticated;
drop policy if exists "anyone records a visit" on public.page_views;
create policy "anyone records a visit" on public.page_views for insert to anon, authenticated
  with check (at > now() - interval '5 minutes' and at < now() + interval '5 minutes');
drop policy if exists "owner reads traffic" on public.page_views;
create policy "owner reads traffic" on public.page_views for select to authenticated using (public.staff_role() = 'owner');

-- Everything the Analytics page shows, in one call. Owner only.
-- p_from / p_to are calendar days (inclusive) in the restaurant's time zone.
create or replace function public.traffic_summary(p_from date, p_to date, p_tz text default 'America/New_York')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t0 timestamptz; t1 timestamptz; p0 timestamptz; days int; res jsonb;
begin
  if coalesce(public.staff_role(), '') <> 'owner' then
    raise exception 'Only the Owner can see website traffic' using errcode = '42501';
  end if;
  if p_to < p_from then p_to := p_from; end if;
  days := p_to - p_from + 1;
  t0 := (p_from::timestamp) at time zone p_tz;
  t1 := ((p_to + 1)::timestamp) at time zone p_tz;
  p0 := ((p_from - days)::timestamp) at time zone p_tz;   -- the same number of days just before, for comparison

  with v as (select * from public.page_views where at >= t0 and at < t1),
  pv as (select * from public.page_views where at >= p0 and at < t0)
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'tz', p_tz,
    'totals', (select jsonb_build_object('views', count(*), 'visitors', count(distinct nullif(visitor, ''))) from v),
    'previous', (select jsonb_build_object('views', count(*), 'visitors', count(distinct nullif(visitor, ''))) from pv),
    'now', (select count(distinct nullif(visitor, '')) from public.page_views where at > now() - interval '30 minutes'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', g.d, 'views', coalesce(x.views, 0), 'visitors', coalesce(x.visitors, 0)) order by g.d), '[]'::jsonb)
                from (select generate_series(p_from, p_to, interval '1 day')::date d) g
                left join (select (at at time zone p_tz)::date d, count(*) views, count(distinct nullif(visitor, '')) visitors from v group by 1) x on x.d = g.d),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('c', c, 'views', views, 'visitors', visitors) order by visitors desc, views desc), '[]'::jsonb)
                from (select country c, count(*) views, count(distinct nullif(visitor, '')) visitors from v where country <> '' group by 1) x),
    'regions', (select coalesce(jsonb_agg(jsonb_build_object('c', c, 'region', region, 'views', views, 'visitors', visitors) order by visitors desc, views desc), '[]'::jsonb)
                from (select country c, region, count(*) views, count(distinct nullif(visitor, '')) visitors from v where region <> '' group by 1, 2) x),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('c', c, 'region', region, 'city', city, 'lat', lat, 'lon', lon, 'views', views, 'visitors', visitors) order by visitors desc, views desc), '[]'::jsonb)
                from (select country c, region, city, round(avg(lat)::numeric, 2) lat, round(avg(lon)::numeric, 2) lon, count(*) views, count(distinct nullif(visitor, '')) visitors
                        from v where city <> '' group by 1, 2, 3 order by 7 desc, 6 desc limit 300) x),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('path', path, 'views', views, 'visitors', visitors) order by views desc), '[]'::jsonb)
                from (select path, count(*) views, count(distinct nullif(visitor, '')) visitors from v group by 1 order by 2 desc limit 20) x),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('src', src, 'kind', kind, 'views', views, 'visitors', visitors) order by visitors desc, views desc), '[]'::jsonb)
                from (select coalesce(nullif(source, ''), nullif(referrer, ''), 'Direct') src,
                             case when source <> '' then 'campaign' when referrer <> '' then 'site' else 'direct' end kind,
                             count(*) views, count(distinct nullif(visitor, '')) visitors
                        from v group by 1, 2 order by 4 desc, 3 desc limit 25) x),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('device', device, 'views', views, 'visitors', visitors) order by visitors desc), '[]'::jsonb)
                from (select coalesce(nullif(device, ''), 'unknown') device, count(*) views, count(distinct nullif(visitor, '')) visitors from v group by 1) x)
  ) into res;
  return res;
end $$;
revoke all on function public.traffic_summary(date, date, text) from public, anon;
grant execute on function public.traffic_summary(date, date, text) to authenticated;
