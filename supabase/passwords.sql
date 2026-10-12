-- Eden staff site: password resets.
--   • Anyone can change their own password while signed in (staff site and staff page): no setup needed.
--   • The Owner and managers can set a temporary password for an employee who forgot theirs or whose
--     password may be known to someone else (Schedule → Employees → Reset password). It signs that person
--     out everywhere, and they must choose their own password the next time they sign in.
--     Managers can reset employees; only the Owner can reset a manager. Nobody can reset the Owner this way
--     (the Owner uses "Forgot password?" by email, or changes it while signed in).
--   • "Forgot password?" by email works once Supabase sends email through your own email service (see README).
-- Run AFTER access-and-timeoff.sql (and history.sql, to record resets in History).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.

create table if not exists public.password_resets (
  user_id uuid primary key,
  set_by  text not null default '',
  set_at  timestamptz not null default now()
);
alter table public.password_resets enable row level security;
revoke all on public.password_resets from anon, authenticated;

-- After signing in: was a temporary password set for me?
create or replace function public.must_change_password() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.password_resets where user_id = auth.uid())
$$;
revoke all on function public.must_change_password() from public, anon;
grant execute on function public.must_change_password() to authenticated;

-- I've chosen my own password.
create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  delete from public.password_resets where user_id = auth.uid()
$$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;

-- Owner / managers: set a temporary password for an employee.
create or replace function public.reset_employee_password(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  target uuid; em text := lower(trim(coalesce(p_email, '')));
  t_role text; t_access text; t_name text; me text; my_role text := public.staff_role();
begin
  if not coalesce(public.can_schedule(), false) then return jsonb_build_object('error', 'not_allowed', 'message', 'Only the Owner and managers can reset passwords.'); end if;
  if length(coalesce(p_password, '')) < 10 then return jsonb_build_object('error', 'short', 'message', 'Use at least 10 characters.'); end if;
  select u.id into target from auth.users u where lower(u.email) = em limit 1;
  if target is null then return jsonb_build_object('error', 'no_account', 'message', 'There’s no account for that email yet. They need to choose Create account on the staff page first.'); end if;
  if target = auth.uid() then return jsonb_build_object('error', 'self', 'message', 'To change your own password, use Change password at the top of the page.'); end if;
  select s.role into t_role from public.staff s where s.user_id = target;
  select e.access, e.name into t_access, t_name from public.employees e where lower(e.email) = em limit 1;
  if t_role = 'owner' then return jsonb_build_object('error', 'not_allowed', 'message', 'The Owner’s password can’t be reset here. Use Forgot password? on the sign-in page.'); end if;
  if (t_role = 'manager' or t_access = 'manager') and coalesce(my_role, '') <> 'owner' then
    return jsonb_build_object('error', 'not_allowed', 'message', 'Only the Owner can reset a manager’s password.');
  end if;

  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = target;
  -- sign them out everywhere (anyone using the old password loses access right away)
  begin
    delete from auth.refresh_tokens where user_id = target::text;
  exception when others then null; end;
  begin
    delete from auth.sessions where user_id = target;
  exception when others then null; end;

  me := coalesce((select s.name from public.staff s where s.user_id = auth.uid()),
                 (select e.name from public.employees e where e.email <> '' and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1), '');
  insert into public.password_resets (user_id, set_by, set_at) values (target, me, now())
    on conflict (user_id) do update set set_by = excluded.set_by, set_at = now();

  -- record it in History (if set up); the password itself is never recorded
  if to_regclass('public.activity_log') is not null then
    execute 'insert into public.activity_log (user_id, email, who, action, tbl, row_key, label) values ($1, $2, $3, $4, $5, $6, $7)'
      using auth.uid(), coalesce(auth.jwt() ->> 'email', ''), coalesce(nullif(me, ''), auth.jwt() ->> 'email', ''), 'update', 'employees', em,
            'Password reset for ' || coalesce(nullif(t_name, ''), em) || ' (temporary password set)';
  end if;
  return jsonb_build_object('ok', true, 'name', coalesce(t_name, em));
end $$;
revoke all on function public.reset_employee_password(text, text) from public, anon;
grant execute on function public.reset_employee_password(text, text) to authenticated;
