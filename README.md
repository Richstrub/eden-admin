# Eden Staff

Private back office for Eden (edencny.com). Staff sign in to edit the menu and the
Supper Club page; changes appear on the public website and the iPad menu within about a second.
Later phases add catering inquiries and BEOs, an events calendar and supplementary reservations.

## How it fits together

- **Public website** (`Richstrub/eden-website`): read-only. Reads the menu live from Supabase,
  and falls back to its built-in copy if the database can't be reached.
- **Staff site** (this repository): a static page, no build step. Sign-in and every permission
  are enforced by Supabase (`supabase/schema.sql`), not by this code.
- **Database**: Supabase project `qmblccwyxbpvziiwrlne`. The publishable key in
  `js/config.js` is meant to be public. Never commit a secret key or `service_role` key.

## Pages

- **Home** (`#home`): tiles for each part of the back office.
- **Menu** (`#menu`): menu, wine list, pairings and Supper Club editor.
- **Schedule** (`#schedule`, Owner and Manager only): employees, the weekly schedule, publishing,
  and texting each person their shifts. One-time setup: run `supabase/schedule.sql` in Supabase.
  Employees can be imported from `templates/eden-employees.xlsx` (Schedule → Employees → Import spreadsheet).
  Texting opens the phone's Messages app with each person's shifts filled in (no texting service needed).

- **Staff schedule page** (`/team/`, every employee): published schedules and the message board.
  One-time setup: run `supabase/team.sql` (after `schedule.sql`), and in Supabase Authentication turn
  **on** "Allow new users to sign up" and turn **off** "Confirm email". Only emails on the employee list
  can create an account (enforced by a database trigger). The page shows first name + last initial,
  position and shift times only; phone numbers and emails never leave the admin side.
  Forgotten password: in Supabase > Authentication > Users, delete that user; they then create a new
  account with the same email. (Email-based resets need a custom email sender, e.g. Google Workspace SMTP.)
  New manager logins must be on the employee list first (the sign-up rule applies to every new account).

## Roles

| Role | Menu and Supper Club |
|---|---|
| Owner | Edit, and manage staff |
| Manager | Edit |
| Kitchen | Edit |
| Front of House | View |

The Schedule (and employees' phone numbers) is visible only to Owner and Manager.

## Adding a staff member (for now)

1. Supabase > Authentication > Users > **Add user** > **Send invitation** (or create with a password).
2. Supabase > SQL Editor, run (change the email, name and role):

```sql
insert into public.staff (user_id, name, role)
select id, 'Full Name', 'manager' from auth.users where email = 'person@example.com'
on conflict (user_id) do update set role = excluded.role, name = excluded.name;
```

Roles: `owner`, `manager`, `kitchen`, `foh`. To remove access: `delete from public.staff where user_id = (select id from auth.users where email = 'person@example.com');`

## First sign-in

If the database has no menu yet, the editor shows **Copy the current menu into the database**.
Click it once; it copies `js/menu-seed.js` (the website's menu at the time of setup).

## Local preview

Any static file server works, for example `npx serve .` or `python3 -m http.server 8090`.
