-- Eden staff site: employee reviews, every 3 months.
-- Run AFTER access-and-timeoff.sql (can_schedule, access_level), team.sql (my_employee_id) and inquiries.sql (inquiry_key_ok).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
--
-- review_plan   one row per employee: when their next review is due (every 3 months), or that they aren't reviewed
-- reviews       each review: the manager's ratings and answers, the goals set, and the employee's own feedback
-- review_mail   when the daily reminder email to managers last went out
--
-- Who sees what
--   The Owner and Managers see and write reviews (a manager never sees their own review here; the Owner sees all).
--   Employees never read these tables. On their team page they see only their own reviews once a manager has shared
--   them (my_reviews), without the manager's private notes, and can add their feedback and sign that they've read it
--   (review_respond).

create table if not exists public.review_plan (
  emp         uuid primary key references public.employees (id) on delete cascade,
  next_due    date,
  skip        boolean not null default false,    -- not reviewed (e.g. the Owner)
  updated_at  timestamptz not null default now()
);

create table if not exists public.reviews (
  id                uuid primary key default gen_random_uuid(),
  emp               uuid not null references public.employees (id) on delete cascade,
  due_date          date,
  review_date       date not null default current_date,
  period_from       date,
  period_to         date,
  position          text not null default '',
  reviewer          text not null default '',
  status            text not null default 'draft' check (status in ('draft', 'shared', 'signed')),
  ratings           jsonb not null default '{}'::jsonb,   -- { category: 1-4 }
  answers           jsonb not null default '{}'::jsonb,   -- { section: text }, rating comments as "c_<category>"
  goals             jsonb not null default '[]'::jsonb,   -- [{ goal, measure, support, result }]
  overall           smallint check (overall between 1 and 4),
  private_notes     text not null default '',             -- managers only, never shown to the employee
  emp_comment       text not null default '',
  emp_support       text not null default '',
  emp_goals         text not null default '',
  emp_signed_at     timestamptz,
  shared_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists reviews_emp on public.reviews (emp, review_date desc);

create table if not exists public.review_mail (
  id         smallint primary key default 1 check (id = 1),
  last_sent  date
);
insert into public.review_mail (id) values (1) on conflict (id) do nothing;

alter table public.review_plan enable row level security;
alter table public.reviews enable row level security;
alter table public.review_mail enable row level security;
revoke all on public.review_plan, public.reviews, public.review_mail from anon;
grant select, insert, update, delete on public.review_plan, public.reviews to authenticated;

-- Clock-in and clock-out times from Square (saved when the Owner imports the Square shifts file on Payroll), compared
-- with the published schedule for the punctuality numbers on each review. Kept apart from pay, so managers can see them.
create table if not exists public.shift_punches (
  id         uuid primary key default gen_random_uuid(),
  emp        uuid not null references public.employees (id) on delete cascade,
  work_date  date not null,
  clock_in   text,           -- 'HH:MM'
  clock_out  text,
  hours      numeric(6,2),
  job        text not null default '',
  source     text not null default 'square',
  created_at timestamptz not null default now()
);
create index if not exists shift_punches_emp on public.shift_punches (emp, work_date);
alter table public.shift_punches enable row level security;
revoke all on public.shift_punches from anon;
grant select, insert, update, delete on public.shift_punches to authenticated;
drop policy if exists "managers" on public.shift_punches;
create policy "managers" on public.shift_punches for all to authenticated using (public.can_schedule()) with check (public.can_schedule());

-- managers: everyone's reviews except their own; the Owner: all of them
create or replace function public.can_review(p_emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.can_schedule(), false)
     and (public.access_level() = 'owner' or p_emp is distinct from public.my_employee_id())
$$;
revoke execute on function public.can_review(uuid) from anon;
grant execute on function public.can_review(uuid) to authenticated;

drop policy if exists "managers" on public.review_plan;
create policy "managers" on public.review_plan for all to authenticated using (public.can_review(emp)) with check (public.can_review(emp));
drop policy if exists "managers" on public.reviews;
create policy "managers" on public.reviews for all to authenticated using (public.can_review(emp)) with check (public.can_review(emp));

-- The employee's side (team page): their shared reviews, without the private notes
create or replace function public.my_reviews() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'review_date', r.review_date, 'period_from', r.period_from, 'period_to', r.period_to, 'position', r.position,
      'reviewer', r.reviewer, 'status', r.status, 'ratings', r.ratings, 'answers', r.answers, 'goals', r.goals, 'overall', r.overall,
      'emp_comment', r.emp_comment, 'emp_support', r.emp_support, 'emp_goals', r.emp_goals, 'emp_signed_at', r.emp_signed_at, 'shared_at', r.shared_at)
    order by r.review_date desc), '[]'::jsonb)
  from public.reviews r
  where public.my_employee_id() is not null and r.emp = public.my_employee_id() and r.status in ('shared', 'signed')
$$;
revoke execute on function public.my_reviews() from anon;
grant execute on function public.my_reviews() to authenticated;

-- The employee's feedback; p_sign = true signs that they've read it (and locks their feedback)
create or replace function public.review_respond(p_id uuid, p_comment text, p_support text, p_goals text, p_sign boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.reviews;
begin
  select * into r from public.reviews where id = p_id;
  if r.id is null or public.my_employee_id() is null or r.emp <> public.my_employee_id() or r.status not in ('shared', 'signed') then
    return jsonb_build_object('error', 'not_found');
  end if;
  if r.status = 'signed' then return jsonb_build_object('error', 'signed'); end if;
  update public.reviews set
    emp_comment = left(coalesce(p_comment, ''), 4000), emp_support = left(coalesce(p_support, ''), 2000), emp_goals = left(coalesce(p_goals, ''), 2000),
    status = case when p_sign then 'signed' else status end,
    emp_signed_at = case when p_sign then now() else emp_signed_at end,
    updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.review_respond(uuid, text, text, text, boolean) from anon;
grant execute on function public.review_respond(uuid, text, text, text, boolean) to authenticated;

-- Anyone on staff without a plan yet (new hires): first review 3 months after they were added, or in 2 weeks if
-- that has already passed. Managers' page calls this when it opens.
create or replace function public.review_plan_fill() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not coalesce(public.can_schedule(), false) then return 0; end if;
  insert into public.review_plan (emp, next_due)
    select e.id, greatest((e.created_at at time zone 'America/New_York')::date + 91, current_date + 14)
    from public.employees e
    where e.active and not exists (select 1 from public.review_plan p where p.emp = e.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.review_plan_fill() from anon;
grant execute on function public.review_plan_fill() to authenticated;

-- The first time only (an empty plan): everyone on staff now is staggered across the next 3 months, longest-serving
-- first, starting two weeks out, so reviews don't all land in the same week. The Owner is left out.
do $$
declare n integer; i integer := 0; e record;
begin
  if exists (select 1 from public.review_plan) then return; end if;
  select count(*) into n from public.employees emp where emp.active and not exists (
    select 1 from public.staff s join auth.users u on u.id = s.user_id where s.role = 'owner' and emp.email <> '' and lower(u.email) = lower(emp.email));
  for e in
    select emp.id, coalesce(exists (
        select 1 from public.staff s join auth.users u on u.id = s.user_id
        where s.role = 'owner' and emp.email <> '' and lower(u.email) = lower(emp.email)), false) as owner
    from public.employees emp where emp.active order by emp.created_at, emp.name
  loop
    if e.owner then
      insert into public.review_plan (emp, next_due, skip) values (e.id, null, true);
    else
      insert into public.review_plan (emp, next_due) values (e.id, current_date + 14 + floor(i * 76.0 / greatest(n - 1, 1))::integer);
      i := i + 1;
    end if;
  end loop;
end $$;

-- The worker's daily reminder (9 am New York time): reviews due in 7 days, due today, and (on Mondays) overdue,
-- plus who to tell (managers on staff with an email). Returns nothing if it already ran today.
create or replace function public.review_reminders_server(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/New_York')::date; hr integer := extract(hour from now() at time zone 'America/New_York');
  last date; res jsonb;
begin
  if not public.inquiry_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  select last_sent into last from public.review_mail where id = 1;
  if hr < 9 or last = today then return jsonb_build_object('due', '[]'::jsonb); end if;
  update public.review_mail set last_sent = today where id = 1;
  select jsonb_build_object(
    'today', today,
    'due', coalesce((select jsonb_agg(jsonb_build_object('name', e.name, 'position', e.position, 'due', p.next_due,
              'days', p.next_due - today) order by p.next_due, e.name)
            from public.review_plan p join public.employees e on e.id = p.emp
            where e.active and not p.skip and p.next_due is not null
              and (p.next_due - today = 7 or p.next_due = today or (p.next_due < today and extract(isodow from today) = 1))), '[]'::jsonb),
    'to', coalesce((select jsonb_agg(distinct lower(e.email)) from public.employees e
            where e.active and e.access = 'manager' and e.email <> ''), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.review_reminders_server(text) from public, authenticated;
grant execute on function public.review_reminders_server(text) to anon;

notify pgrst, 'reload schema';
