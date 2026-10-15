-- Eden staff site: End of day reports (the Owner and managers).
-- Paste into Supabase > SQL Editor > New query, click Run. Safe to run more than once.
-- One row per report. Numbers have their own columns (so they add up in Excel); the database works out the
-- average spend per cover itself. Drafts save as you type; "Submit" stamps who prepared it and when.
-- The Owner and managers can read, write and reopen reports; only the Owner can delete one.

create table if not exists public.eod_reports (
  id                      uuid primary key default gen_random_uuid(),
  report_date             date not null default (now() at time zone 'America/New_York')::date,
  shift                   text not null default 'dinner' check (shift in ('dinner', 'private', 'both')),
  status                  text not null default 'draft' check (status in ('draft', 'submitted')),
  reservations            integer check (reservations >= 0),
  actual_covers           integer check (actual_covers >= 0),
  walk_ins                integer check (walk_ins >= 0),
  cancellations           integer check (cancellations >= 0),
  private_events          text not null default '',
  service_rating          smallint check (service_rating between 1 and 5),
  overview                text not null default '',
  net_sales               numeric(10,2) check (net_sales >= 0),
  food_sales              numeric(10,2) check (food_sales >= 0),
  beverage_sales          numeric(10,2) check (beverage_sales >= 0),
  total_covers            integer check (total_covers >= 0),
  avg_per_cover   numeric(10,2) generated always as (case when total_covers > 0 and net_sales is not null then round(net_sales / total_covers, 2) end) stored,  -- the database works this out
  comps                   text not null default '',
  voids                   text not null default '',
  payment_discrepancies   text not null default '',
  cash_deposit            numeric(10,2) check (cash_deposit >= 0),
  compliments             text not null default '',
  complaints              text not null default '',
  vips                    text not null default '',
  dietary                 text not null default '',
  guest_followups         text not null default '',
  dishes_returned         text not null default '',
  quality_concerns        text not null default '',
  sold_out                text not null default '',
  beverage_notes          text not null default '',
  coordination_issues     text not null default '',
  attendance              text not null default '',
  exceptional             text not null default '',
  training_needs          text not null default '',
  conduct_issues          text not null default '',
  staff_followup          text not null default '',
  equipment_issues        text not null default '',
  maintenance             text not null default '',
  supplies                text not null default '',
  safety_concerns         text not null default '',
  lost_found              text not null default '',
  incidents               text not null default '',
  stock_shortages         text not null default '',
  waste                   text not null default '',
  inventory_discrepancies text not null default '',
  closing_done            boolean,
  closing_outstanding     text not null default '',
  next_reservations       text not null default '',
  next_dietary            text not null default '',
  next_menu               text not null default '',
  next_staffing           text not null default '',
  next_followups          text not null default '',
  next_priorities         text not null default '',
  action_items            jsonb not null default '[]'::jsonb,
  went_well               text not null default '',
  needs_improvement       text not null default '',
  final_priorities        text not null default '',
  prepared_by             text not null default '',
  prepared_by_id          uuid references auth.users (id) on delete set null,
  submitted_at            timestamptz,
  edited_after_submit_at  timestamptz,
  edited_after_submit_by  text not null default '',
  title                   text not null default '',
  created_by              uuid references auth.users (id) on delete set null default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists eod_reports_date on public.eod_reports (report_date desc);

alter table public.eod_reports enable row level security;
revoke all on public.eod_reports from anon;
grant select, insert, update, delete on public.eod_reports to authenticated;

drop policy if exists "owner and managers read" on public.eod_reports;
create policy "owner and managers read" on public.eod_reports for select to authenticated
  using (public.access_level() in ('owner', 'manager'));
drop policy if exists "owner and managers write" on public.eod_reports;
create policy "owner and managers write" on public.eod_reports for insert to authenticated
  with check (public.access_level() in ('owner', 'manager'));
drop policy if exists "owner and managers change" on public.eod_reports;
create policy "owner and managers change" on public.eod_reports for update to authenticated
  using (public.access_level() in ('owner', 'manager')) with check (public.access_level() in ('owner', 'manager'));
drop policy if exists "owner deletes, or your own draft" on public.eod_reports;
create policy "owner deletes, or your own draft" on public.eod_reports for delete to authenticated
  using (public.staff_role() = 'owner' or (status = 'draft' and created_by = auth.uid()));

-- keeps the title (shown in History) and the times right, whoever saves
create or replace function public.eod_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.title := 'End of day report · ' || to_char(new.report_date, 'Dy Mon FMDD, YYYY') || ' · ' ||
    case new.shift when 'dinner' then 'Dinner' when 'private' then 'Private event' else 'Dinner and private event' end;
  if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.submitted_at is not distinct from old.submitted_at
     and (to_jsonb(new) - array['updated_at', 'tips_sent_at', 'tips_sent', 'edited_after_submit_at', 'edited_after_submit_by'])
         is distinct from (to_jsonb(old) - array['updated_at', 'tips_sent_at', 'tips_sent', 'edited_after_submit_at', 'edited_after_submit_by']) then
    new.edited_after_submit_at := now();   -- sending the tip emails alone doesn't count as a change
  end if;
  return new;
end $$;
drop trigger if exists eod_touch on public.eod_reports;
create trigger eod_touch before insert or update on public.eod_reports for each row execute function public.eod_touch();

-- record changes in Analytics > History, if that's set up
do $$ begin
  if exists (select 1 from pg_proc where proname = 'log_activity' and pronamespace = 'public'::regnamespace) then
    drop trigger if exists eod_reports_log on public.eod_reports;
    create trigger eod_reports_log after insert or update or delete on public.eod_reports for each row execute function public.log_activity();
  end if;
end $$;
