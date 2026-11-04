-- Eden staff site: Website → Analytics → Staff logins. When staff sign in and use the admin site and the staff page.
-- Run AFTER supabase/schema.sql and supabase/team.sql. Paste into Supabase > SQL Editor > New query and click Run.
-- Safe to run more than once.
--
-- staff_visits   one row per visit: a person using the admin site or the staff page, from the moment they open it
--                until they've been away 30 minutes. signed_in = they typed their password to start it
--                (otherwise the browser kept them signed in). pages = how many pages they opened.
-- Nobody reads the table directly: staff log their own visit with log_staff_visit(), and only the Owner reads
-- them, with staff_activity().

create table if not exists public.staff_visits (
  id          bigserial primary key,
  user_id     uuid not null,
  email       text not null default '',
  site        text not null default 'admin',          -- 'admin' (managers' site) or 'staff' (staff page)
  device      text not null default '',               -- 'phone', 'tablet' or 'computer'
  signed_in   boolean not null default false,
  pages       integer not null default 1,
  started_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists staff_visits_user on public.staff_visits (user_id, last_seen desc);
create index if not exists staff_visits_started on public.staff_visits (started_at desc);
alter table public.staff_visits enable row level security;
revoke all on public.staff_visits from anon, authenticated;

create or replace function public.log_staff_visit(p_site text, p_device text, p_signin boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); em text; st text := case when p_site = 'staff' then 'staff' else 'admin' end; v_id bigint;
begin
  if uid is null then return; end if;
  select lower(email) into em from auth.users where id = uid;
  select id into v_id from public.staff_visits
    where user_id = uid and site = st and last_seen > now() - interval '30 minutes' and not coalesce(p_signin, false)
    order by last_seen desc limit 1;
  if v_id is not null then
    update public.staff_visits set last_seen = now(), pages = pages + 1 where id = v_id;
  else
    insert into public.staff_visits (user_id, email, site, device, signed_in)
    values (uid, coalesce(em, ''), st, left(coalesce(p_device, ''), 20), coalesce(p_signin, false));
  end if;
end $$;
revoke all on function public.log_staff_visit(text, text, boolean) from public, anon;
grant execute on function public.log_staff_visit(text, text, boolean) to authenticated;

-- the Owner's view: every visit in the period, and everyone who has a login (with Supabase's own last sign-in)
create or replace function public.staff_activity(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  v jsonb;
  p jsonb;
begin
  if coalesce(public.staff_role(), '') <> 'owner' then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'email', x.email, 'site', x.site, 'device', x.device,
           'signed_in', x.signed_in, 'pages', x.pages,
           'start', x.started_at, 'last', x.last_seen)
         order by x.started_at desc), '[]'::jsonb)
    into v
    from public.staff_visits x
   where x.started_at >= p_from and x.started_at < p_to;

  select coalesce(jsonb_agg(jsonb_build_object(
           'email', lower(u.email),
           'name', coalesce(
              (select e.name from public.employees e
                where lower(trim(e.email)) = lower(u.email) limit 1),
              (select s.name from public.staff s where s.user_id = u.id),
              u.email),
           'position', (select e.position from public.employees e
                         where lower(trim(e.email)) = lower(u.email) limit 1),
           'role', (select s.role from public.staff s where s.user_id = u.id),
           'last_sign_in', u.last_sign_in_at,
           'last_seen', (select max(y.last_seen) from public.staff_visits y
                          where y.user_id = u.id))), '[]'::jsonb)
    into p
    from auth.users u
   where lower(u.email) in (select lower(trim(e.email)) from public.employees e
                             where coalesce(e.email, '') <> '')
      or u.id in (select s.user_id from public.staff s
                   where coalesce(s.role, '') <> 'hub');

  return jsonb_build_object('visits', v, 'people', p);
end $$;
revoke all on function public.staff_activity(timestamptz, timestamptz) from public, anon;
grant execute on function public.staff_activity(timestamptz, timestamptz) to authenticated;
