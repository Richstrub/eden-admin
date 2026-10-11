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
  A shift ends at a set time or at a server out time: 1st cut (counted as about 8pm), 2nd cut (about 9pm)
  or Close (about 10pm). Weekly totals that include one of these are shown as "about N" hours.
  Texting opens the phone's Messages app with each person's shifts filled in (no texting service needed).

- **Staff schedule page** (`/team/`, every employee): published schedules and the message board.
  One-time setup: run `supabase/team.sql` (after `schedule.sql`), and in Supabase Authentication turn
  **on** "Allow new users to sign up" and turn **off** "Confirm email". Only emails on the employee list
  can create an account (enforced by a database trigger). The page shows coworkers' full names (supabase/full-names.sql),
  position and shift times only; phone numbers and emails never leave the admin side.
  Forgotten password: in Supabase > Authentication > Users, delete that user; they then create a new
  account with the same email. (Email-based resets need a custom email sender, e.g. Google Workspace SMTP.)
  New manager logins must be on the employee list first (the sign-up rule applies to every new account).

- **Permissions and time off**: run `supabase/access-and-timeoff.sql` (after `team.sql`). Each employee has
  an access level, set by the Owner on Schedule → Employees: **Employee** (sees the posted schedule,
  requests time off, message board) or **Manager** (also edits/publishes the schedule, approves time off,
  texts the team; signs in on this site and sees Home, Schedule and Prep List). Time-off requests wait for a
  Manager or the Owner on Schedule → Time off; approved time off shows on the grid and the month view.
- **Prep List** (`#prep`, Owner, Manager, Kitchen and Manager-tier employees): a prep sheet built from the
  live Kitchen menu (Basics, then each dish's title ingredients and description components, plus add-ons),
  laid out as one landscape 11 x 8.5 page with each section as its own panel in three columns. By dish or
  Combined. "Bar prep" switches to a separate bar list built from the cocktail menu. Print opens a preview
  of the page; "Confirm print" prints exactly what's shown. Pars, added items and removed lines are kept in
  that computer's browser.
- **Inventory** (`#inventory`, Owner, Managers, Kitchen): three inventories — Food, Paper goods, and
  Beer, wine & liquor — each with items (section, unit, pack size, vendor, par, cost) and dated counts.
  Type what's on hand; it saves as you go and shows the last count, what to order (par − on hand), value
  on hand, and an order list by vendor. Starters: add wines/beers/spirits or ingredients from the menu,
  a common paper-goods list, or import `templates/eden-inventory.xlsx`. One-time setup: run
  `supabase/inventory.sql` (after `access-and-timeoff.sql`).
- **Quick add** (top of every menu editor tab): type an item, choose which section of that tab it goes in,
  and Add. On the drink tabs, picking an inventory item fills the name and sets the matching section.
- **Menu ↔ inventory**: in the menu editor's Wine, Beer & Soft Drinks, Spirits and Coffee & Tea tabs
  (not Kitchen or Cocktails), the item-name field suggests matching inventory items (best fit for the
  section first; items already on the menu are greyed out) and can add a new name to the inventory.
  "+ From inventory" under each section lists inventory items not yet on the menu to add with one click.
- **Notes** (top bar, far right; everyone): full-screen notes for iPad + Apple Pencil (pressure ink,
  palm rejection, eraser, undo) or typed text (iPad Scribble turns Pencil writing into text in the Text
  tab). "Convert to text" reads the handwriting with Tesseract (loaded on demand; neat print reads best).
  Notes autosave and are private to their author. Email (mailto), Share (handwriting attached, iPad share
  sheet), or "Add to to-do" (one per line or one item). **To-do** (`#todo`, top bar): shared list with due
  dates, overdue flags, details and a link back to the source note. One-time setup: `supabase/notes.sql`.
- **Recipes** (`#recipes` on the staff site, and a Recipes tab on the staff page): the recipe book.
  Owner and Managers create/edit (paste an ingredient list and it's split into amount/unit/item/note);
  everyone on the team can read. Scale by ½×–4×, any multiplier, or "make N <yield unit>"; Smart units
  converts to the easiest measure (48 tsp → 1 cup, 2000 g → 2 kg) with kitchen fractions. Print a card.
  One-time setup: `supabase/recipes.sql`.
- **Calendar** (`#calendar` on the staff site; Calendar tab on the staff page): events by Day (hour
  timeline, same look as staff shifts), Week and Month. Owner and Managers add/edit (type, date, all-day or
  times, room, guests, notes) with double-booking warnings per room; the whole team can read. Events carry
  `source`/`beo_id` so BEOs can add them later. One-time setup: `supabase/calendar.sql`.
- **Week / Month**: both the Schedule page and the staff page switch between a week and a month view.

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
