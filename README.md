# Eden Staff

Private back office for Eden (edencny.com). Staff sign in to edit the menu and the
Supper Club page; changes appear on the public website and the iPad menu within about a second.
Later phases add catering inquiries and BEOs, an events calendar and supplementary reservations.

## How it fits together

- **Public website** (`Richstrub/eden-website`): read-only. Reads the menu live from Supabase,
  and falls back to its built-in copy if the database can't be reached.
- **Staff site** (this repository): static pages, no build step, plus one small Cloudflare worker
  (`worker.js`) that only counts website visits. Sign-in and every permission are enforced by
  Supabase (`supabase/schema.sql`), not by this code.
- **Database**: Supabase project `qmblccwyxbpvziiwrlne`. The publishable key in
  `js/config.js` is meant to be public. Never commit a secret key or `service_role` key.

## Pages

Navigation: a side menu grouped as **Today**, **Service** (Pre-shift meeting, End of day report, Reservations soon), **Front of house** (Menu & Supper Club, Calendar, Catering & BEOs), **Kitchen & bar** (Prep List, Inventory, Recipes), **Team** (Schedule, Staff page, Payroll) and **Owner** (Business email, Analytics & History). Each person only sees what their role can open; small counts show what's waiting. Notes, To-do and the account menu (website, password, sign out) are at the bottom. On phones and iPads held upright the menu opens from the ☰ button. The top strip shows where you are; pages opened from Today get a "← Today · N left" button.

- **Today** (`#home`, `js/today.js`): "Needs you" — new catering inquiries and questionnaires back, time-off requests, next week's schedule not published (from Wednesday), stock below par (latest counts), last week's payroll not finalized (Owner), to-dos due — each with one button that goes straight there, filtered to what the person's role can act on. Beside it: tonight's events and who's working, the week ahead, recent shared notes, and links to the website and iPad menu.
- **Pre-shift meeting** (`#preshift`, everyone), **End of day report** (`#eod`, Owner and managers), **Business email** (`#email`, Owner): placeholder pages, coming next.
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
- **Weeks start on Sunday** (Sun–Sat) on the Schedule, staff page and Calendar. Existing Monday-start weeks: run `supabase/sunday-weeks.sql` once. Each person on the Schedule grid has "Copy last week" (skips days with approved time off).
- **Catering & BEOs** (`#catering`, Owner and managers): tabs **Inquiries**, **Active BEOs** (soonest event first), **Completed & declined** and **Spam**. Each event moves through: New inquiry → Questionnaire sent → Questionnaire back → Active BEO → Completed. The page shows the next step for each (send the questionnaire link, start the BEO, mark completed), the guest's details and menu choices, the **conversation** (every email to and from the guest, calls and emails logged by hand, and each step), and team notes. **Start the BEO / Open BEO** opens the BEO form (`templates/beo-form.html`) filled in from the questionnaire; every change in that window is saved with the event in the database, so it's the same on every computer. Also: Add to calendar, Download answers; Owner can delete. See *Catering inquiries and email (setup)* below.
- **Payroll** (`#payroll`, Owner only), two sub-pages. One-time setup: run `supabase/payroll.sql` (pay rates and payroll are readable by the Owner only; managers and staff get nothing back).
  - **Weekly payroll** (`#payroll`): one Sunday–Saturday week at a time, opening on the week that just ended. Hours per person per day start from the published schedule (shifts ending at 1st cut / 2nd cut / close count as 8 / 9 / 10 pm and are marked to check); correct any day and it saves automatically. Works out regular hours, overtime (over 40 in the week at 1.5 × the hourly rate; salaried staff get their weekly salary, no overtime), the week's **tip pool** split by hours among tip-pool staff (to the cent, adding up to the pool exactly), an adjustment with a note, and gross pay. **Print summary** and **Download for accountant (.xlsx)** (sheets *Payroll* and *Tip pool*; a CSV if the spreadsheet library can't load). **Finalize week** locks it and freezes the pay rates used; **Reopen week** undoes that. Tax withholding is left to the accountant.
  - **Pay rates** (`#payroll/rates`): hourly rate or weekly salary per employee, whether they share the tip pool, and notes. Changes are recorded in History.
- **Analytics** (`#analytics`, Owner only, top bar after Reservations), two sub-pages:
  - **Website traffic** (`#analytics`): visitors and page views on edencny.com over 7 days, 30 days, 90 days or 12 months (with the previous period for comparison), a world map (or United States map) shaded by visitors with a dot per city, and lists of countries, cities, US states, how people found the site, pages and devices. Visits are sent by the public site (`js/analytics.js` there) to `/t` on this site, where `worker.js` adds Cloudflare's approximate location and saves them with the publishable key (`supabase/analytics.sql`: anyone may add a visit, only the Owner can read them). No IP addresses, names or cookies are stored; a visitor is an anonymous code that changes daily. The map files load from cdn.jsdelivr.net.
  - **History** (`#analytics/history`; old `#history` links still work): every add/change/delete on the staff site and staff page, by whom and when, written by database triggers (`supabase/history.sql`). Quick repeat saves fold into one line; private notes are not logged.
- **Week / Month**: both the Schedule page and the staff page switch between a week and a month view.

## Catering inquiries and email (setup)

How it works:
1. The website's catering page is a short form (about the guest and their event). It goes to `/inquiry` on this site (`worker.js`), which screens out bots and saves it in Supabase with a private key only it and the database know. It shows under Inquiries, and Tyler and Rich (`NOTIFY_TO` in `wrangler.jsonc`) get an email.
2. From the inquiry, a manager clicks **Send questionnaire link**. The guest gets a private link (`SITE_URL#plan-<code>`) that opens the full questionnaire with what they sent already filled in.
3. When they send it, their choices, estimate and BEO mapping land on the same inquiry (Questionnaire back) and the team gets an email.
4. **Start the BEO**: the BEO form opens filled in; it's saved with the event under Active BEOs.

Emails to the guest are sent from the staff site (as `MAIL_FROM`) and saved in the conversation. Their replies go to an address unique to that inquiry and are saved there too (and copied to the team). Until email is set up, **Open in my email app** writes the same message in your own email program and saves it to the conversation; replies come to your inbox, and you can paste them in with **Log a call or email**.

Bot screening on the short form: Cloudflare Turnstile (invisible for most people), a hidden field only bots fill in, a "sent within 15 seconds" check, sanity checks (real email, a date between today and three years out, a guest count), and at most 3 inquiries an hour from one connection or 3 a day for one email address. Suspicious ones are kept under **Spam** with the reason.

Setup (each step works on its own; anything not set up is skipped):
1. **Database** (required): in Supabase → SQL Editor, run `supabase/inquiries.sql` (after `history.sql`). Run it again whenever this file changes; it updates in place. The first time only, also run `select public.new_inquiry_key();` and copy the long code it shows.
2. **Inquiry key** (required): Cloudflare → Workers & Pages → eden-admin → Settings → Variables and Secrets → Add → type **Secret**, name `INQUIRY_KEY`, value: the code from step 1.
3. **Turnstile** (recommended): Cloudflare → Turnstile → Add widget, hostnames `edencny.com`, `www.edencny.com` and `eden-website.richard-a-strub.workers.dev`, mode **Managed**. Add the **Site Key** as secret `TURNSTILE_SITE_KEY` and the **Secret Key** as secret `TURNSTILE_SECRET`.
4. **Sending email** (resend.com): add and verify the domain `edencny.com` (DNS records), create an API key, add it as secret `RESEND_API_KEY`.
5. **Receiving replies** (resend.com): in Emails → Receiving, note your receiving domain (e.g. `abc123.resend.app`, or set up a subdomain such as `reply.edencny.com`); add it as secret `INBOUND_DOMAIN`. In Webhooks, add `https://eden-admin.richard-a-strub.workers.dev/inbound` for the event `email.received` and add its signing secret as secret `RESEND_WEBHOOK_SECRET`.

The Catering & BEOs page shows a status line saying which of these are working. When edencny.com points to the new website, change `SITE_URL` in `wrangler.jsonc` and `guestSite` in `js/config.js` to `https://edencny.com/`.

## Business email (Google Workspace)

The Business email page (menu: Office) shows your edencny.com Gmail mailboxes. Nothing is copied to the staff site:
every list, email and attachment comes from Gmail each time, and every action (send, reply, reply all, forward,
delete, delete forever, archive, move to a folder, new folder, star, mark read or unread, spam) is done in Gmail
itself. So the staff site and Gmail always match; changes made in Gmail or on a phone show here within a minute.

- Who: the Owner and managers. The Owner chooses who can open each mailbox (Manage mailboxes); a manager can
  connect their own mailbox. Front-of-house and kitchen staff never see the page.
- Setup, once: run `supabase/business-email.sql`; make a Google OAuth client (Internal, Gmail API on, redirect
  `https://edencny-staff.com/mail/callback`); add the secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
  `MAIL_TOKEN_KEY` in Cloudflare. The page walks you through it and ticks each step off.
- Security: the Google permission for each mailbox is stored encrypted with `MAIL_TOKEN_KEY`, which exists only in
  Cloudflare. Emails open in a sealed frame (no scripts). Disconnect also cancels the permission at Google.
- Code: `js/email.js` (the page) and `mail-worker.js` (talks to Gmail).

## Address (edencny-staff.com)

The staff site lives at **https://edencny-staff.com/** (staff page: `/team/`). The old `eden-admin.richard-a-strub.workers.dev` address keeps working; `js/move.js` sends people from it to the same page on the new address as soon as the new one answers (it checks `/here`), bringing along the prep list pars and an unsaved note kept in that browser. Where the address is set: `staffHome` in `js/config.js`, optional `STAFF_URL` in `wrangler.jsonc` (links in team emails), `staffSite` in the public website's `js/config.js` (inquiries, visit counter, `#editor`), Supabase → Authentication → URL Configuration (redirect URL `https://edencny-staff.com/**`), and the Resend webhook (`https://edencny-staff.com/inbound`).

## Notes and the shared folder

Everyone who signs in to the staff site has **Notes** (top bar): handwriting or typed, private to the writer. The Owner and managers also get a **Shared folder**: press **Share with team** next to the note’s title (or **+ New** under Shared folder) and the Owner and every manager can read and edit it. Each shared note shows who wrote it and who changed it last; only the writer can move it back to private; the writer or the Owner can delete it. Kitchen and Front of House logins keep private notes only. One-time setup: run `supabase/shared-notes.sql` (after `notes.sql`).

## Passwords

- **Change password** (everyone): the **Password** button at the top of the staff site and the staff page. It asks for the current password, and can sign out every other phone, tablet and computer (use that if someone else may know the password).
- **Temporary password** (Owner and managers): Schedule → Employees → **Reset password** next to anyone with an account. It signs them out everywhere and sets a temporary password to give them in person or by text; the next time they sign in, they must choose their own. Managers can reset employees; only the Owner can reset a manager; the Owner's own password can't be reset this way. Resets are recorded in History (the password itself never is). Setup: run `supabase/passwords.sql` once.
- **Forgot password?** (by email, on both sign-in pages): Supabase sends the reset link. Its built-in email only reaches members of your Supabase team (and only a couple of emails an hour), so for employees it works once Supabase sends through Resend: Supabase → Authentication → Emails → SMTP Settings, using Resend's SMTP details (host `smtp.resend.com`, port 465, user `resend`, password: a Resend API key, sender e.g. `events@edencny.com`). Also in Supabase → Authentication → URL Configuration, add `https://eden-admin.richard-a-strub.workers.dev/**` to Redirect URLs so the link comes back to the right page.

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
