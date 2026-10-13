-- Eden staff site: managers can create (or fix) an employee's login directly, without any email.
-- Run AFTER supabase/passwords.sql and supabase/staff-signup.sql.
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- Schedule > Employees > "Create login" (or "Set password" for an account stuck waiting on its confirmation email):
-- the manager picks a temporary password and tells the employee in person or by text. The account is ready at
-- once (no confirmation email needed); the first time they sign in they choose their own password.
-- Managers can do this for employees; only the Owner can for managers. Nobody can do it for the Owner.

-- 1. The Employees tab now knows whether an account is confirmed (it used to call unconfirmed accounts "Active")
drop function if exists public.employee_accounts();
create or replace function public.employee_accounts() returns table (email text, created_at timestamptz, last_sign_in_at timestamptz, confirmed boolean)
language sql stable security definer set search_path = public, auth as $$
  select lower(u.email)::text, u.created_at, u.last_sign_in_at, (u.email_confirmed_at is not null)
  from auth.users u
  where public.can_schedule()
    and lower(u.email) in (select lower(trim(e.email)) from public.employees e where e.email <> '')
$$;
revoke all on function public.employee_accounts() from public, anon;
grant execute on function public.employee_accounts() to authenticated;

-- 2. Create or fix a login with a temporary password
create or replace function public.create_employee_login(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  em text := lower(trim(coalesce(p_email, '')));
  emp record; uid uuid; created boolean := false; me text; my_role text := public.staff_role(); t_role text; c record;
begin
  if not coalesce(public.can_schedule(), false) then return jsonb_build_object('error', 'not_allowed', 'message', 'Only the Owner and managers can do this.'); end if;
  if length(coalesce(p_password, '')) < 10 then return jsonb_build_object('error', 'short', 'message', 'Use at least 10 characters.'); end if;
  select * into emp from public.employees where lower(trim(email)) = em limit 1;
  if not found then return jsonb_build_object('error', 'not_listed', 'message', 'Add this email to the employee first.'); end if;
  if emp.active is false then return jsonb_build_object('error', 'inactive', 'message', 'Turn on “On schedule” for this employee first.'); end if;
  if emp.access = 'manager' and coalesce(my_role, '') <> 'owner' then return jsonb_build_object('error', 'not_allowed', 'message', 'Only the Owner can set up a manager’s login.'); end if;

  select id into uid from auth.users where lower(email) = em limit 1;
  if uid is not null then
    select s.role into t_role from public.staff s where s.user_id = uid;
    if t_role = 'owner' then return jsonb_build_object('error', 'not_allowed', 'message', 'The Owner’s login can’t be changed here.'); end if;
    if uid = auth.uid() then return jsonb_build_object('error', 'self', 'message', 'To change your own password, use Change password.'); end if;
    update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = uid;
    begin delete from auth.refresh_tokens where user_id = uid::text; exception when others then null; end;
    begin delete from auth.sessions where user_id = uid; exception when others then null; end;
  else
    uid := gen_random_uuid(); created := true;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em, crypt(p_password, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
    -- Supabase's sign-in service expects these text columns to be empty, not missing
    for c in select column_name from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and data_type in ('character varying', 'text')
               and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current',
                                   'email_change', 'phone_change', 'phone_change_token', 'reauthentication_token') loop
      execute format('update auth.users set %I = coalesce(%I, %L) where id = $1', c.column_name, c.column_name, '') using uid;
    end loop;
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, 'email', jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), now(), now(), now());
  end if;

  -- they choose their own password the first time they sign in
  me := coalesce((select s.name from public.staff s where s.user_id = auth.uid()),
                 (select e.name from public.employees e where e.email <> '' and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1), '');
  insert into public.password_resets (user_id, set_by, set_at) values (uid, me, now())
    on conflict (user_id) do update set set_by = excluded.set_by, set_at = now();
  if to_regclass('public.activity_log') is not null then
    execute 'insert into public.activity_log (user_id, email, who, action, tbl, row_key, label) values ($1, $2, $3, $4, $5, $6, $7)'
      using auth.uid(), coalesce(auth.jwt() ->> 'email', ''), coalesce(nullif(me, ''), auth.jwt() ->> 'email', ''), 'update', 'employees', em,
            (case when created then 'Login created for ' else 'Login fixed for ' end) || coalesce(nullif(emp.name, ''), em) || ' (temporary password set)';
  end if;
  return jsonb_build_object('ok', true, 'created', created, 'name', coalesce(emp.name, em), 'email', em);
end $$;
revoke all on function public.create_employee_login(text, text) from public, anon;
grant execute on function public.create_employee_login(text, text) to authenticated;
