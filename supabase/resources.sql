-- Eden staff site: Resources — a library of PDFs for the whole team, sorted into Food, Beverage and Hospitality.
-- Run AFTER supabase/preshift.sql (it uses the private "preshift-education" file storage set up there).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- The Owner and managers send a PDF here from Pre-shift > Education ("Send to resources"), or add one on the
-- Resources page, giving it a title and a category. Everyone on the team can find it (search by title) and open it.
-- The Owner and managers can retitle, re-sort or delete a resource. Resources keep their own copy of the file,
-- so deleting the PDF from Pre-shift doesn't remove it from Resources.

create table if not exists public.resources (
  id          text primary key,
  title       text not null check (length(trim(title)) > 0),
  category    text not null check (category in ('food', 'beverage', 'hospitality')),
  file_path   text not null,
  file_size   bigint not null default 0,
  author      text not null default '',
  user_id     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists resources_cat on public.resources (category, title);
alter table public.resources enable row level security;
revoke all on public.resources from anon;
grant select, insert, update, delete on public.resources to authenticated;

drop policy if exists "team reads resources" on public.resources;
create policy "team reads resources" on public.resources for select to authenticated using (public.is_team());
drop policy if exists "managers add resources" on public.resources;
create policy "managers add resources" on public.resources for insert to authenticated
  with check (public.can_schedule() and user_id = auth.uid());
drop policy if exists "managers change resources" on public.resources;
create policy "managers change resources" on public.resources for update to authenticated
  using (public.can_schedule()) with check (public.can_schedule());
drop policy if exists "managers delete resources" on public.resources;
create policy "managers delete resources" on public.resources for delete to authenticated using (public.can_schedule());

-- who added it is filled in by the database; a change keeps the file, the adder and the date added
create or replace function public.resources_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.file_path := old.file_path; new.file_size := old.file_size; new.author := old.author;
    new.user_id := old.user_id; new.created_at := old.created_at; new.updated_at := now();
    return new;
  end if;
  new.user_id := auth.uid();
  new.author := coalesce((select nullif(s.name, '') from public.staff s where s.user_id = auth.uid() limit 1),
                         (select nullif(e.name, '') from public.employees e where e.email <> '' and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1),
                         nullif(auth.jwt() ->> 'email', ''), '');
  return new;
end $$;
revoke all on function public.resources_guard() from public, anon, authenticated;
drop trigger if exists resources_guard on public.resources;
create trigger resources_guard before insert or update on public.resources for each row execute function public.resources_guard();
