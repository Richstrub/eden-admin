-- Eden staff site: Notes (private to each person) and the shared To-do list.
-- Run AFTER supabase/access-and-timeoff.sql. Paste into Supabase > SQL Editor > New query, click Run.
-- Safe to run more than once.
--
-- Notes:  each signed-in staff-site user sees and edits only their own notes.
-- To-do:  shared by everyone who can sign in to the staff site (staff roles and Manager-tier employees).

create or replace function public.can_todo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() is not null or public.can_schedule(), false)
$$;
revoke execute on function public.can_todo() from anon;
grant execute on function public.can_todo() to authenticated;

create table if not exists public.notes (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null default '',
  body       text not null default '',          -- typed / converted text
  ink        jsonb not null default '[]'::jsonb, -- handwriting strokes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user on public.notes (user_id, updated_at desc);

create table if not exists public.todos (
  id          text primary key,
  title       text not null,
  details     text not null default '',
  due         date,
  done        boolean not null default false,
  done_at     timestamptz,
  created_by  text not null default '',
  note_id     text,                              -- the note it came from, if any
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

grant select, insert, update, delete on public.notes to authenticated;
grant select, insert, update, delete on public.todos to authenticated;
alter table public.notes enable row level security;
alter table public.todos enable row level security;

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_todo());

drop policy if exists "team to-dos" on public.todos;
create policy "team to-dos" on public.todos
  for all to authenticated using (public.can_todo()) with check (public.can_todo());

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes for each row execute function public.touch_row();
drop trigger if exists todos_touch on public.todos;
create trigger todos_touch before update on public.todos for each row execute function public.touch_row();
