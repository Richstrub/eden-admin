-- Eden staff site: email sign-offs for Business email.
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
-- Each person's three-line sign-off (with the Eden picture beside it) is added to the emails they send
-- from the staff site. Everyone can change their own on the Business email page; the Owner can change anyone's.

create table if not exists public.mail_signatures (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  line1       text not null default '',
  line2       text not null default '',
  line3       text not null default '',
  updated_at  timestamptz not null default now()
);
alter table public.mail_signatures enable row level security;
revoke all on public.mail_signatures from anon;
grant select, insert, update, delete on public.mail_signatures to authenticated;

drop policy if exists "own sign-off, Owner all" on public.mail_signatures;
create policy "own sign-off, Owner all" on public.mail_signatures for all to authenticated
  using (user_id = auth.uid() or public.staff_role() = 'owner')
  with check ((user_id = auth.uid() and public.staff_role() in ('owner', 'manager')) or public.staff_role() = 'owner');

-- Starting sign-offs (only added where nothing is saved yet)
insert into public.mail_signatures (user_id, line1, line2, line3)
select user_id, 'Rich Strub', 'Chef / Owner', 'Eden Hospitality' from public.staff
where role = 'owner' and (name ilike 'rich%' or name ilike '%strub%')
on conflict (user_id) do nothing;
insert into public.mail_signatures (user_id, line1, line2, line3)
select user_id, 'Tyler Ball', 'Front of House Manager', 'Eden Hospitality' from public.staff
where name ilike 'tyler%'
on conflict (user_id) do nothing;

select s.name, m.line1, m.line2, m.line3 from public.mail_signatures m left join public.staff s on s.user_id = m.user_id;
