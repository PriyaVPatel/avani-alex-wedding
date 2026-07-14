# Avani & Alex RSVP Site — Setup Guide

Three pieces: **Google Sheet** (guest list + event details) → **Apps Script** (API) → **GitHub Pages** (the site) → **avaniandalex.com** (Squarespace DNS).

Event details (addresses, times) live in the Sheet, not in the website code — the API only sends a party the events they're invited to, so nobody can read house-event details out of the page source.

---

## 1. Google Sheet

1. Create a new Google Sheet named e.g. `A&A Wedding RSVPs`.
2. Create two tabs, named exactly `Guests` and `Events`.
3. Import `sheet-templates/Guests.csv` into the **Guests** tab and `sheet-templates/Events.csv` into the **Events** tab (File → Import → Upload → *Replace current sheet*, import into the right tab).
4. In **Guests**, select the five `Invited_*` columns and do Insert → Checkbox (optional, but makes editing painless). Replace the sample rows with the real list:
   - One **row per guest**, grouped by `PartyID` (e.g. `P001`, `P002`…). Everyone sharing a `PartyID` shows up together when any one of them searches their name.
   - `PartyName` is the heading guests see (“The Patel Family”).
   - Tick the `Invited_*` boxes per guest. Leave `RSVP_*`, `Meal`, `Note`, `SubmittedAt` blank — the site fills those.
5. In **Events**, fill in the two placeholders:
   - `TIME_TBD` for the mehndi (Oct 7) and vidhi/pithi (Oct 8)
   - `LOCATION_TBD` for the rehearsal dinner
   You can edit titles, attire lines, and details freely — the site renders whatever is in this tab, no code change needed.

## 2. Apps Script (the API)

1. In the Sheet: **Extensions → Apps Script**.
2. Delete the placeholder code and paste in `apps-script/Code.gs`. Save.
3. **Deploy → New deployment → type: Web app**
   - Description: `rsvp-api`
   - Execute as: **Me**
   - Who has access: **Anyone** ← required so the site can call it
4. Authorize when prompted, then copy the **Web app URL** (ends in `/exec`).
5. Paste that URL into `app.js` as `API_URL` (top of the file). The meal choices (Chicken / Salmon / Vegan) are already set in `MEAL_OPTIONS`.

Test it: open `YOUR_EXEC_URL?action=lookup&name=Deep%20Patel` in a browser — you should get JSON back with the party and events.

> Any time you edit `Code.gs` later, use **Deploy → Manage deployments → ✏️ → New version** so the same URL picks up the change. Editing the *Sheet* never requires redeploying.

## 3. GitHub Pages

1. Create a repo (e.g. `avani-alex-wedding`) and push everything in this folder (`index.html`, `styles.css`, `app.js`, `assets/`, `CNAME`). The `apps-script/` and `sheet-templates/` folders are reference material — fine to include, or keep the repo private-ish by leaving them out.
2. Repo → **Settings → Pages** → Source: `Deploy from a branch` → Branch: `main` / `(root)`. Save.
3. In **Settings → Pages → Custom domain**, enter `avaniandalex.com` (the `CNAME` file in the repo keeps this sticky across deploys).

## 4. Point avaniandalex.com at GitHub (Squarespace)

In Squarespace: **Domains → avaniandalex.com → DNS Settings**, then add:

| Type  | Host | Value               |
|-------|------|---------------------|
| A     | @    | 185.199.108.153     |
| A     | @    | 185.199.109.153     |
| A     | @    | 185.199.110.153     |
| A     | @    | 185.199.111.153     |
| CNAME | www  | `YOURUSERNAME.github.io` |

Delete any conflicting Squarespace-default A/CNAME records on `@` and `www`. DNS can take up to a few hours; once GitHub shows the domain verified, tick **Enforce HTTPS** in the Pages settings.

## 5. Content still marked in the code

Search the project for `EDIT ME` / `TBD`:

- `index.html` — the "Our Story" paragraph (I wrote a placeholder), and the RSVP help email (`rsvp@avaniandalex.com` — swap in a real inbox or phone number).
- `app.js` — `API_URL` (the only required code edit).
- `Events` tab — mehndi & vidhi/pithi times, rehearsal dinner location.

## How guests use it

1. Guest opens avaniandalex.com, hits **RSVP**, types their name.
2. The site fetches their party — spouse/kids appear automatically — and shows **only the events they're invited to**, with full details.
3. They accept/decline per person per event, pick a reception meal per person, add a note, submit. Answers land in the `RSVP_*`, `Meal`, `Note`, `SubmittedAt` columns.
4. Re-submitting overwrites cleanly, so guests can update their reply any time by searching again.

## Nice-to-haves you can bolt on later

- **Notify on RSVP:** in Apps Script add a `MailApp.sendEmail(...)` call at the end of `doPost` to email Avani when a party replies.
- **Response dashboard:** a third tab with `=COUNTIF(Guests!L:L,"Yes")`-style formulas for live headcounts per event / per meal.
- **Invite codes:** if name-guessing ever worries you, add a `Code` column per party and require it in the lookup.
