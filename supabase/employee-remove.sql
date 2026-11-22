-- Eden staff site: Employees → Remove. Takes someone off the roster without deleting them: they come off the schedule,
-- their login stops working (logins need an active employee), and their payroll, pay rates and reviews stay on file.
-- Paste into Supabase > SQL Editor > New query and click Run. Safe to run more than once.
alter table public.employees add column if not exists removed_at timestamptz;
