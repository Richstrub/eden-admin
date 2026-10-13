-- Eden staff site: the Cook permission and a shared, fillable Prep List.
-- Run AFTER supabase/access-and-timeoff.sql. Paste into Supabase > SQL Editor > New query, click Run.
-- Safe to run more than once.
--
-- Cook: a permission on the Employees tab (only the Owner can set it). A cook has the same access as an
--   employee, and can also see and fill in the Prep List (on the staff page's Prep List tab).
-- Prep List: what's done, on hand, to prep and who did it is saved for everyone (Owner, managers, Kitchen
--   logins and cooks all see the same list). The Owner and managers can reset it for the next day; if nobody
--   does, it resets itself at 8:00 pm (New York time). A reset clears the filled-in values only: items added to
--   the list and lines taken off it stay.

-- 1. The Cook permission
alter table public.employees drop constraint if exists employees_access_check;
alter table public.employees add constraint employees_access_check check (access in ('employee', 'cook', 'server', 'manager'));

create or replace function public.is_cook() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees
                 where active and access = 'cook' and email <> ''
                   and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke execute on function public.is_cook() from anon;
grant execute on function public.is_cook() to authenticated;

-- who can see and fill in the Prep List: the Owner, managers, Kitchen logins and cooks
create or replace function public.can_prep() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() in ('owner', 'manager', 'kitchen'), false) or coalesce(public.can_schedule(), false) or coalesce(public.is_cook(), false)
$$;
revoke execute on function public.can_prep() from anon;
grant execute on function public.can_prep() to authenticated;

-- 2. The shared Prep List (one row)
create table if not exists public.prep_lists (
  id          text primary key default 'eden',
  for_date    date not null default (now() at time zone 'America/New_York')::date,
  entries     jsonb not null default '{}'::jsonb,   -- { line: { done, onhand, prep, ini, by, at } }
  extra       jsonb not null default '{}'::jsonb,   -- { section: [ "Pickled shallots", … ] } items added to the list
  removed     jsonb not null default '{}'::jsonb,   -- { line: 1 } lines taken off the list
  reset_at    timestamptz,
  reset_by    text not null default '',
  reset_auto  boolean not null default false,
  updated_at  timestamptz not null default now()
);
insert into public.prep_lists (id) values ('eden') on conflict (id) do nothing;
alter table public.prep_lists enable row level security;
revoke all on public.prep_lists from anon, authenticated;
grant select on public.prep_lists to authenticated;
drop policy if exists "prep team reads" on public.prep_lists;
create policy "prep team reads" on public.prep_lists for select to authenticated using (coalesce(public.can_prep(), false));
-- all changes go through the functions below

create or replace function public.prep_me() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(s.name, '') from public.staff s where s.user_id = auth.uid() limit 1),
                  (select nullif(e.name, '') from public.employees e where e.email <> '' and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1),
                  nullif(auth.jwt() ->> 'email', ''), '')
$$;
revoke all on function public.prep_me() from public, anon, authenticated;

-- 8:00 pm reset (New York time), unless someone already reset it that afternoon or evening.
-- Also catches up if the list is still for a day that has passed.
create or replace function public.prep_auto() returns void
language plpgsql security definer set search_path = public as $$
declare t timestamp := now() at time zone 'America/New_York'; r public.prep_lists;
begin
  insert into public.prep_lists (id) values ('eden') on conflict (id) do nothing;
  select * into r from public.prep_lists where id = 'eden' for update;
  if t::time >= time '20:00' and (r.reset_at is null or (r.reset_at at time zone 'America/New_York') < t::date + time '14:00') then
    update public.prep_lists set entries = '{}'::jsonb, for_date = t::date + 1, reset_at = now(), reset_by = '', reset_auto = true, updated_at = now() where id = 'eden';
  elsif r.for_date < t::date then
    update public.prep_lists set entries = '{}'::jsonb, for_date = t::date, reset_at = now(), reset_by = '', reset_auto = true, updated_at = now() where id = 'eden';
  end if;
end $$;
revoke all on function public.prep_auto() from public, anon, authenticated;

create or replace function public.prep_row() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'id' || jsonb_build_object('can_reset', coalesce(public.can_schedule(), false), 'me', public.prep_me()) from public.prep_lists p where id = 'eden'
$$;
revoke all on function public.prep_row() from public, anon, authenticated;

-- the list as it is now
create or replace function public.prep_get() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_prep(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  perform public.prep_auto();
  return public.prep_row();
end $$;

-- fill in one box: p_field is done, onhand, prep or ini
create or replace function public.prep_set(p_key text, p_field text, p_value text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; v jsonb;
begin
  if not coalesce(public.can_prep(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  if p_field not in ('done', 'onhand', 'prep', 'ini') or length(coalesce(p_key, '')) not between 1 and 400 then return jsonb_build_object('error', 'bad'); end if;
  perform public.prep_auto();
  v := case when p_field = 'done' then to_jsonb(coalesce(p_value, '') in ('true', '1', 'yes')) else to_jsonb(left(coalesce(p_value, ''), case when p_field = 'ini' then 6 else 40 end)) end;
  select coalesce(entries -> p_key, '{}'::jsonb) into cur from public.prep_lists where id = 'eden' for update;
  cur := cur || jsonb_build_object(p_field, v, 'by', public.prep_me(), 'at', now());
  update public.prep_lists set entries = jsonb_set(entries, array[p_key], cur, true), updated_at = now() where id = 'eden';
  return jsonb_build_object('ok', true, 'entry', cur);
end $$;

-- add or take away an item someone added to a section
create or replace function public.prep_extra(p_section text, p_name text, p_add boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; nm text := left(trim(coalesce(p_name, '')), 120);
begin
  if not coalesce(public.can_prep(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  if nm = '' or length(coalesce(p_section, '')) not between 1 and 200 then return jsonb_build_object('error', 'bad'); end if;
  select coalesce(extra -> p_section, '[]'::jsonb) into cur from public.prep_lists where id = 'eden' for update;
  cur := coalesce((select jsonb_agg(x) from jsonb_array_elements_text(cur) x where lower(x) <> lower(nm)), '[]'::jsonb);
  if p_add then cur := cur || to_jsonb(nm); end if;
  update public.prep_lists set extra = case when jsonb_array_length(cur) = 0 then extra - p_section else jsonb_set(extra, array[p_section], cur, true) end, updated_at = now() where id = 'eden';
  return public.prep_row();
end $$;

-- take a line off the list (p_on true), put it back (false); p_key null with false puts every line back
create or replace function public.prep_hide(p_key text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_prep(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  if p_key is null then update public.prep_lists set removed = '{}'::jsonb, updated_at = now() where id = 'eden';
  elsif p_on then update public.prep_lists set removed = jsonb_set(removed, array[p_key], '1'::jsonb, true), updated_at = now() where id = 'eden';
  else update public.prep_lists set removed = removed - p_key, updated_at = now() where id = 'eden'; end if;
  return public.prep_row();
end $$;

-- the Owner and managers: clear the filled-in values for the next day
create or replace function public.prep_reset() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t timestamp := now() at time zone 'America/New_York';
begin
  if not coalesce(public.can_schedule(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  insert into public.prep_lists (id) values ('eden') on conflict (id) do nothing;
  update public.prep_lists set entries = '{}'::jsonb, for_date = case when t::time >= time '14:00' then t::date + 1 else t::date end,
    reset_at = now(), reset_by = public.prep_me(), reset_auto = false, updated_at = now() where id = 'eden';
  return public.prep_row();
end $$;

-- once: bring over items added and lines removed that were saved on one computer before the list was shared
create or replace function public.prep_import(p_extra jsonb, p_removed jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_prep(), false) then return jsonb_build_object('error', 'not_allowed'); end if;
  update public.prep_lists set
    extra = case when extra = '{}'::jsonb and jsonb_typeof(p_extra) = 'object' then p_extra else extra end,
    removed = case when removed = '{}'::jsonb and jsonb_typeof(p_removed) = 'object' then p_removed else removed end,
    updated_at = now() where id = 'eden';
  return public.prep_row();
end $$;

-- for the staff site's worker (every 20 minutes), so the 8:00 pm reset happens even if nobody opens the list
create or replace function public.prep_auto_server(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  perform public.prep_auto();
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.prep_get(), public.prep_set(text, text, text), public.prep_extra(text, text, boolean),
  public.prep_hide(text, boolean), public.prep_reset(), public.prep_import(jsonb, jsonb) from public, anon;
grant execute on function public.prep_get(), public.prep_set(text, text, text), public.prep_extra(text, text, boolean),
  public.prep_hide(text, boolean), public.prep_reset(), public.prep_import(jsonb, jsonb) to authenticated;
revoke all on function public.prep_auto_server(text) from public, authenticated;
grant execute on function public.prep_auto_server(text) to anon;
