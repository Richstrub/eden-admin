-- Eden staff site: History (activity log).
-- Records every add, change and delete made through the staff site and the staff page: what it was,
-- which account did it, and when. Only the Owner can read it. Private notes are not logged.
-- Run AFTER the other setup files (it attaches to whichever of these tables exist).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.

create table if not exists public.activity_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  user_id  uuid,
  email    text not null default '',
  who      text not null default '',
  action   text not null,              -- insert, update, delete
  tbl      text not null,              -- which part of the site (table name)
  row_key  text not null default '',
  label    text not null default '',   -- what it was, in words
  changes  jsonb not null default '{}'::jsonb,   -- for changes: { field: {old, new} }
  edits    integer not null default 1  -- quick successive saves of the same thing are folded into one line
);
-- full before / after copies, so the History page can show exactly what changed
alter table public.activity_log add column if not exists old_row jsonb;
alter table public.activity_log add column if not exists new_row jsonb;
create index if not exists activity_log_at on public.activity_log (at desc);
create index if not exists activity_log_fold on public.activity_log (user_id, tbl, row_key, at desc);

alter table public.activity_log enable row level security;
grant select on public.activity_log to authenticated;
drop policy if exists "owner reads history" on public.activity_log;
create policy "owner reads history" on public.activity_log for select to authenticated using (public.staff_role() = 'owner');

-- keep long values readable in the log
create or replace function public.log_short(v jsonb) returns jsonb
language sql immutable as $$
  select case
    when v is null then 'null'::jsonb
    when jsonb_typeof(v) = 'array' and length(v::text) > 300 then to_jsonb('(' || jsonb_array_length(v) || ' items)')
    when jsonb_typeof(v) = 'object' and length(v::text) > 300 then to_jsonb('(details changed)'::text)
    when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 300 then to_jsonb(left(v #>> '{}', 300) || '…')
    else v end
$$;

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text := coalesce(auth.jwt() ->> 'email', '');
  j jsonb; o jsonb; k text; rkey text; lbl text; ch jsonb := '{}'::jsonb; prev bigint; whoname text;
  added jsonb; removed jsonb;
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then o := to_jsonb(old); end if;
  rkey := coalesce(j ->> 'id', j ->> 'path', j ->> 'week_start', j ->> 'user_id', '');
  lbl := coalesce(nullif(j ->> 'title', ''), nullif(j ->> 'name', ''), j ->> 'path', rkey);

  -- labels in words
  if tg_table_name = 'site_docs' then
    lbl := case
      when j ->> 'path' like 'site/menu/groups/%' then 'Menu section: ' || coalesce(nullif(j #>> '{data,title}', ''), 'untitled')
      when j ->> 'path' = 'site/menu' then 'Menu tabs and layout'
      when j ->> 'path' = 'site/supper' then 'Supper Club page'
      else j ->> 'path' end;
  elsif tg_table_name = 'schedule_weeks' then lbl := 'Week of ' || to_char((j ->> 'week_start')::date, 'Mon FMDD, YYYY');
  elsif tg_table_name = 'inventory_counts' then lbl := initcap(replace(j ->> 'category', 'bev', 'beer, wine & liquor')) || ' count for ' || to_char((j ->> 'count_date')::date, 'Mon FMDD');
  elsif tg_table_name = 'time_off' then
    lbl := coalesce((select e.name from public.employees e where e.id::text = j ->> 'emp'), 'Employee') || ', ' ||
           to_char((j ->> 'start_date')::date, 'Mon FMDD') ||
           case when j ->> 'end_date' <> j ->> 'start_date' then ' to ' || to_char((j ->> 'end_date')::date, 'Mon FMDD') else '' end;
  elsif tg_table_name = 'board_posts' then lbl := left(coalesce(j ->> 'body', ''), 90);
  elsif tg_table_name = 'staff' then lbl := coalesce(nullif(j ->> 'name', ''), 'Staff login') || ' (' || coalesce(j ->> 'role', '') || ')';
  elsif tg_table_name = 'events' then lbl := coalesce(j ->> 'title', 'Event') || ' · ' || to_char((j ->> 'date')::date, 'Mon FMDD');
  end if;

  -- what changed
  if tg_op = 'UPDATE' then
    if tg_table_name = 'site_docs' then
      select coalesce(jsonb_agg(n ->> 'name'), '[]'::jsonb) into added
        from jsonb_array_elements(coalesce(j #> '{data,items}', '[]'::jsonb)) n
        where not exists (select 1 from jsonb_array_elements(coalesce(o #> '{data,items}', '[]'::jsonb)) m where m = n);
      select coalesce(jsonb_agg(m ->> 'name'), '[]'::jsonb) into removed
        from jsonb_array_elements(coalesce(o #> '{data,items}', '[]'::jsonb)) m
        where not exists (select 1 from jsonb_array_elements(coalesce(j #> '{data,items}', '[]'::jsonb)) n where n ->> 'name' = m ->> 'name');
      if jsonb_array_length(added) > 0 then ch := ch || jsonb_build_object('items added or changed', added); end if;
      if jsonb_array_length(removed) > 0 then ch := ch || jsonb_build_object('items removed', removed); end if;
      for k in select x from jsonb_object_keys(coalesce(j -> 'data', '{}'::jsonb)) x loop
        if k <> 'items' and (j -> 'data' -> k) is distinct from (o -> 'data' -> k) then
          ch := ch || jsonb_build_object(k, jsonb_build_object('old', public.log_short(o -> 'data' -> k), 'new', public.log_short(j -> 'data' -> k)));
        end if;
      end loop;
    else
      for k in select x from jsonb_object_keys(j) x loop
        if k in ('updated_at', 'updated_by', 'created_at') then continue; end if;
        if (j -> k) is distinct from (o -> k) then
          ch := ch || jsonb_build_object(k, jsonb_build_object('old', public.log_short(o -> k), 'new', public.log_short(j -> k)));
        end if;
      end loop;
    end if;
    if ch = '{}'::jsonb then return null; end if;
  end if;

  whoname := coalesce((select s.name from public.staff s where s.user_id = uid),
                      (select e.name from public.employees e where e.email <> '' and lower(e.email) = lower(em) limit 1),
                      nullif(em, ''), 'Supabase dashboard');

  -- fold quick successive saves of the same thing by the same person into one line
  if tg_op = 'UPDATE' then
    select a.id into prev from public.activity_log a
      where a.user_id is not distinct from uid and a.tbl = tg_table_name and a.row_key = rkey and a.action = 'update' and a.at > now() - interval '10 minutes'
      order by a.at desc limit 1;
    if prev is not null then
      update public.activity_log a set at = now(), edits = a.edits + 1, label = lbl, new_row = j,
        old_row = coalesce(a.old_row, o),
        changes = a.changes || coalesce((select jsonb_object_agg(x,
          case when jsonb_typeof(ch -> x) = 'array' then
                 (select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from jsonb_array_elements(coalesce(a.changes -> x, '[]'::jsonb) || (ch -> x)) v)
               else jsonb_build_object('old', coalesce(a.changes -> x -> 'old', ch -> x -> 'old'), 'new', ch -> x -> 'new') end)
          from jsonb_object_keys(ch) x), '{}'::jsonb)
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

-- attach to every part of the site that exists (private notes are left out on purpose)
do $$
declare t text;
begin
  foreach t in array array['site_docs', 'staff', 'employees', 'schedule_weeks', 'time_off', 'board_posts',
                           'inventory_items', 'inventory_counts', 'recipes', 'events', 'todos'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists log_activity on public.%I', t);
      execute format('create trigger log_activity after insert or update or delete on public.%I for each row execute function public.log_activity()', t);
    end if;
  end loop;
end $$;
