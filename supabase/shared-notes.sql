-- Eden staff site: a shared notes folder for the Owner and managers.
-- Notes stay private unless someone moves one into the shared folder ("Shared · Owner & managers").
-- Shared notes can be read and edited by the Owner and every manager (staff role Manager, or an employee
-- with Manager permissions). Each note remembers who wrote it and who changed it last. Only the person who
-- wrote a note can move it back to private; the writer or the Owner can delete a shared note.
-- Kitchen and Front-of-House logins keep private notes only.
-- Run AFTER supabase/notes.sql. Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.

alter table public.notes add column if not exists shared    boolean not null default false;
alter table public.notes add column if not exists author    text    not null default '';
alter table public.notes add column if not exists edited_by text    not null default '';
create index if not exists notes_shared on public.notes (shared, updated_at desc) where shared;

-- who wrote it / changed it last, and nobody can take over someone else's note
create or replace function public.notes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  who := coalesce((select nullif(s.name, '') from public.staff s where s.user_id = auth.uid() limit 1),
                  (select nullif(e.name, '') from public.employees e where e.email <> '' and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1),
                  nullif(auth.jwt() ->> 'email', ''), '');
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.author := old.author;
    if new.user_id is distinct from auth.uid() then new.shared := true; end if;   -- only the writer can make it private again
  else
    new.author := who;
  end if;
  new.edited_by := who;
  return new;
end $$;
revoke all on function public.notes_guard() from public, anon, authenticated;
drop trigger if exists notes_guard on public.notes;
create trigger notes_guard before insert or update on public.notes for each row execute function public.notes_guard();

-- who can see and change what
drop policy if exists "own notes" on public.notes;
drop policy if exists "notes read" on public.notes;
drop policy if exists "notes add" on public.notes;
drop policy if exists "notes change" on public.notes;
drop policy if exists "notes delete" on public.notes;
create policy "notes read" on public.notes for select to authenticated
  using (user_id = auth.uid() or (shared and public.can_schedule()));
create policy "notes add" on public.notes for insert to authenticated
  with check (user_id = auth.uid() and public.can_todo() and (not shared or public.can_schedule()));
create policy "notes change" on public.notes for update to authenticated
  using ((user_id = auth.uid() and public.can_todo()) or (shared and public.can_schedule()))
  with check ((user_id = auth.uid() and public.can_todo() and (not shared or public.can_schedule())) or (shared and public.can_schedule()));
create policy "notes delete" on public.notes for delete to authenticated
  using (user_id = auth.uid() or (shared and public.staff_role() = 'owner'));
