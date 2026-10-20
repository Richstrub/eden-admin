-- Tax-exempt clients: New York State Form ST-119.1 (Exempt Organization Exempt Purchase Certificate)
-- A guest who answers "tax exempt" on the questionnaire must attach the form before they can send it.
-- The form is kept with the inquiry; the Owner and managers (the people who can see inquiries) can open it
-- from Catering & BEOs and from the BEO, and can attach one themselves.
-- Run this once in Supabase (SQL Editor). Safe to run again.

create table if not exists public.inquiry_files (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.catering_inquiries(id) on delete cascade,
  kind text not null default 'st119',
  name text not null default '',
  mime text not null default 'application/pdf',
  size integer not null default 0,
  data text not null,                       -- the file, base64
  added_by text not null default 'guest',   -- 'guest' or the staff member's name
  created_at timestamptz not null default now()
);
create index if not exists inquiry_files_inquiry on public.inquiry_files (inquiry_id, kind);
alter table public.inquiry_files enable row level security;

drop policy if exists "managers read inquiry files" on public.inquiry_files;
create policy "managers read inquiry files" on public.inquiry_files for select to authenticated using (public.can_schedule());
drop policy if exists "managers add inquiry files" on public.inquiry_files;
create policy "managers add inquiry files" on public.inquiry_files for insert to authenticated with check (public.can_schedule());
drop policy if exists "managers remove inquiry files" on public.inquiry_files;
create policy "managers remove inquiry files" on public.inquiry_files for delete to authenticated using (public.can_schedule());

-- The guest's form, from their private questionnaire link (through the worker). Replaces an earlier one.
create or replace function public.attach_plan_file(p_key text, p_token text, p_kind text, p_name text, p_mime text, p_data text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.catering_inquiries; fid uuid; k text := coalesce(nullif(p_kind, ''), 'st119');
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  if coalesce(p_token, '') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error', 'not_found'); end if;
  select * into q from public.catering_inquiries where plan_token = p_token;
  if q.id is null or q.status = 'spam' then return jsonb_build_object('error', 'not_found'); end if;
  if q.status in ('beo', 'completed', 'declined') then return jsonb_build_object('error', 'locked'); end if;
  if k <> 'st119' then return jsonb_build_object('error', 'bad'); end if;
  if coalesce(p_mime, '') not in ('application/pdf', 'image/jpeg', 'image/png') then return jsonb_build_object('error', 'type'); end if;
  if length(coalesce(p_data, '')) < 100 or length(p_data) > 7000000 then return jsonb_build_object('error', 'size'); end if;
  delete from public.inquiry_files where inquiry_id = q.id and kind = k;
  insert into public.inquiry_files (inquiry_id, kind, name, mime, size, data, added_by)
    values (q.id, k, left(coalesce(p_name, 'ST-119.1'), 160), p_mime, (length(p_data) * 3 / 4), p_data, 'guest')
    returning id into fid;
  return jsonb_build_object('id', fid);
end $$;
revoke all on function public.attach_plan_file(text, text, text, text, text, text) from public;
grant execute on function public.attach_plan_file(text, text, text, text, text, text) to anon, authenticated;

-- Whether a form is already on file for a questionnaire link (name only), so a guest who sends again needn't re-attach.
create or replace function public.plan_file_info(p_key text, p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.catering_inquiries; f record;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  if coalesce(p_token, '') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error', 'not_found'); end if;
  select * into q from public.catering_inquiries where plan_token = p_token;
  if q.id is null then return jsonb_build_object('error', 'not_found'); end if;
  select name, created_at into f from public.inquiry_files where inquiry_id = q.id and kind = 'st119' order by created_at desc limit 1;
  return jsonb_build_object('st119', case when f.name is null then null else jsonb_build_object('name', f.name, 'at', f.created_at) end);
end $$;
revoke all on function public.plan_file_info(text, text) from public;
grant execute on function public.plan_file_info(text, text) to anon, authenticated;
