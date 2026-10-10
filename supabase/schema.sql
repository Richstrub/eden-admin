-- Eden staff site: database setup (Phase 1).
-- Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
-- Replace YOUR-EMAIL on the last line with the Owner's login email.

-- 1. Staff and roles: owner, manager, kitchen, foh (front of house)
create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('owner','manager','kitchen','foh')),
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.staff_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.staff where user_id = auth.uid() $$;

drop policy if exists "read own row, owner reads all" on public.staff;
create policy "read own row, owner reads all" on public.staff
  for select to authenticated
  using (user_id = auth.uid() or public.staff_role() = 'owner');
drop policy if exists "owner manages staff" on public.staff;
create policy "owner manages staff" on public.staff
  for all to authenticated
  using (public.staff_role() = 'owner')
  with check (public.staff_role() = 'owner');

-- 2. Website content (menu, Supper Club): anyone can read, owner/manager/kitchen can edit
create table if not exists public.site_docs (
  path text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);
alter table public.site_docs enable row level security;

drop policy if exists "anyone can read website content" on public.site_docs;
create policy "anyone can read website content" on public.site_docs
  for select to anon, authenticated using (true);
drop policy if exists "editors can add" on public.site_docs;
create policy "editors can add" on public.site_docs
  for insert to authenticated
  with check (public.staff_role() in ('owner','manager','kitchen'));
drop policy if exists "editors can change" on public.site_docs;
create policy "editors can change" on public.site_docs
  for update to authenticated
  using (public.staff_role() in ('owner','manager','kitchen'))
  with check (public.staff_role() in ('owner','manager','kitchen'));
drop policy if exists "editors can remove" on public.site_docs;
create policy "editors can remove" on public.site_docs
  for delete to authenticated
  using (public.staff_role() in ('owner','manager','kitchen'));

create or replace function public.touch_updated() returns trigger
language plpgsql as $$
begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end $$;
drop trigger if exists site_docs_touch on public.site_docs;
create trigger site_docs_touch before update on public.site_docs
  for each row execute function public.touch_updated();

grant select on public.site_docs to anon, authenticated;
grant insert, update, delete on public.site_docs to authenticated;
grant select, insert, update, delete on public.staff to authenticated;

-- 3. Live updates
do $$ begin
  alter publication supabase_realtime add table public.site_docs;
exception when duplicate_object then null;
end $$;

-- 4. Make the Owner
insert into public.staff (user_id, name, role)
select id, 'Richard Strub', 'owner' from auth.users where email = 'YOUR-EMAIL'
on conflict (user_id) do update set role = 'owner';
