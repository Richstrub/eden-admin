-- Eden staff site: assign to-dos to any staff member.
-- Run AFTER supabase/notes.sql and supabase/team.sql. Paste into Supabase > SQL Editor > New query, click Run.
-- Safe to run more than once (run it again after updates: it adds anything new).
--
-- The Owner and managers can give a to-do to anyone on the employee list. It then shows on that person's own
-- staff page (Schedule tab, "Your to-dos"), where they can tick it off. Staff only ever see their own to-dos,
-- through the two functions below; they can't read the to-do list itself.

alter table public.todos add column if not exists assigned_to   uuid references public.employees (id) on delete set null;
alter table public.todos add column if not exists assigned_name text not null default '';
alter table public.todos add column if not exists assigned_by   text not null default '';
-- whose to-do it is on the staff site: new to-dos belong to whoever adds them, unless they give them to someone
alter table public.todos add column if not exists assigned_user uuid references auth.users (id) on delete set null;
create index if not exists todos_assigned on public.todos (assigned_to) where assigned_to is not null;

-- the signed-in staff member's own to-dos (open ones, and ones finished in the last week)
create or replace function public.my_todos() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'details', t.details, 'due', t.due, 'done', t.done, 'done_at', t.done_at,
      'assigned_by', coalesce(nullif(t.assigned_by, ''), t.created_by), 'created_at', t.created_at)
    order by t.done, t.due nulls last, t.created_at), '[]'::jsonb)
  from public.todos t
  where public.my_employee_id() is not null
    and t.assigned_to = public.my_employee_id()
    and (not t.done or t.done_at > now() - interval '7 days')
$$;

-- tick one of your own to-dos done (or not done)
create or replace function public.finish_my_todo(p_id text, p_done boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('public.section_ok(text)') is not null and not public.section_ok('todos.done') then return jsonb_build_object('ok', false); end if;   -- Team > Permissions
  update public.todos set done = p_done, done_at = case when p_done then now() end
  where id = p_id and assigned_to is not null and assigned_to = public.my_employee_id();
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.my_todos(), public.finish_my_todo(text, boolean) from public, anon;
grant execute on function public.my_todos(), public.finish_my_todo(text, boolean) to authenticated;

-- Who can see a to-do: only the person who wrote it and the person it's given to.
-- A to-do you write for yourself (not given to anyone) is yours alone; nobody else sees it, Owner included.
alter table public.todos add column if not exists created_user uuid references auth.users (id) on delete set null default auth.uid();
-- older to-dos: work out who wrote them from the name saved with them; anything left over goes to the Owner
update public.todos t set created_user = s.user_id from public.staff s
  where t.created_user is null and t.created_by <> '' and lower(s.name) = lower(t.created_by);
update public.todos t set created_user = u.id from public.employees e join auth.users u on lower(u.email) = lower(e.email)
  where t.created_user is null and t.created_by <> '' and e.email <> '' and lower(e.name) = lower(t.created_by);
update public.todos set created_user = (select user_id from public.staff where role = 'owner' order by created_at limit 1)
  where created_user is null;
-- "mine" for to-dos nobody was given: the person who wrote them
update public.todos set assigned_user = created_user where assigned_user is null and assigned_to is null;

drop policy if exists "team to-dos" on public.todos;
drop policy if exists "your to-dos" on public.todos;
create policy "your to-dos" on public.todos for select to authenticated
  using (created_user = auth.uid() or assigned_user = auth.uid() or (assigned_to is not null and assigned_to = public.my_employee_id()));
drop policy if exists "add your to-dos" on public.todos;
create policy "add your to-dos" on public.todos for insert to authenticated
  with check (public.can_todo() and created_user = auth.uid());
drop policy if exists "change your to-dos" on public.todos;
create policy "change your to-dos" on public.todos for update to authenticated
  using (created_user = auth.uid() or assigned_user = auth.uid() or (assigned_to is not null and assigned_to = public.my_employee_id()))
  with check (true);
drop policy if exists "delete your to-dos" on public.todos;
create policy "delete your to-dos" on public.todos for delete to authenticated
  using (created_user = auth.uid());
