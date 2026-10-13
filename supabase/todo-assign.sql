-- Eden staff site: assign to-dos to any staff member.
-- Run AFTER supabase/notes.sql and supabase/team.sql. Paste into Supabase > SQL Editor > New query, click Run.
-- Safe to run more than once.
--
-- The Owner and managers can give a to-do to anyone on the employee list. It then shows on that person's own
-- staff page (Schedule tab, "Your to-dos"), where they can tick it off. Staff only ever see their own to-dos,
-- through the two functions below; they can't read the to-do list itself.

alter table public.todos add column if not exists assigned_to   uuid references public.employees (id) on delete set null;
alter table public.todos add column if not exists assigned_name text not null default '';
alter table public.todos add column if not exists assigned_by   text not null default '';
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
  update public.todos set done = p_done, done_at = case when p_done then now() end
  where id = p_id and assigned_to is not null and assigned_to = public.my_employee_id();
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.my_todos(), public.finish_my_todo(text, boolean) from public, anon;
grant execute on function public.my_todos(), public.finish_my_todo(text, boolean) to authenticated;
