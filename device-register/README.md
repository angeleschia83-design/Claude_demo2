# Device register

A shared record of who holds which company laptop or iPad, built from the
IT Hardware Asset Management workbook. People outside the company can be given
a link and make corrections without an account of any kind.

It exists because the workbook disagrees with itself: `MONITORING_EMPLOYEES`
lists only 342 of the 543 laptops and iPads that `Asset Central Inventory`
marks as assigned, so anyone reading the monitoring sheet alone sees far more
people with no device than really have none.

## What it is built on

- **Asset Central Inventory is the only source of devices.** A person appears
  here only if that tab names them on a Laptop, Imac or iPad whose status is
  `Active/ Assigned`.
- **`Asset Central Inventory (2)` is deliberately ignored.** Its assignee names
  were sorted independently of the serial numbers, so they no longer line up
  with the hardware. Checked against the monitoring sheet, the main tab agrees
  on 342 of 342 serials and tab (2) on 114 of 265.
- **MONITORING_EMPLOYEES supplies a job title only**, matched by name, which is
  what decides Sales vs HO. Nobody enters the register through it.

## Sales, HO, Unknown

| Label | Meaning |
|---|---|
| `Sales` | The matched job title contains "Financial Advisor" — plain, senior or executive grade. |
| `HO` | A job title was found and it is not a Financial Advisor grade. |
| `Unknown` | No job title could be matched to that name. 78 holders start here. |

The guess is only a starting point. Anything set in the app overrides it and
survives every later import.

Names are matched in three widening tiers, and each tier only answers when
exactly one employee fits, so an ambiguous surname stays `Unknown` rather than
being guessed at:

1. **exact name** — surname and given name both match.
2. **first name** — `Marco Bernardo` in the inventory finds `Marco Philippe
   Bernardo` on the monitoring sheet.
3. **spelling** — `Siegfried Bactung` finds `Siegfred Bactung`, at 0.82
   similarity or better and clearly ahead of the runner-up.

Each holder's `label_source` column records which tier answered, so an inferred
match can always be checked.

## Running it

Requires Node 20 or newer, and Python 3 with `openpyxl` for the import step.

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env` and set `ADMIN_PASSWORD` and `SESSION_SECRET` — the app refuses to
start while either still holds its placeholder. Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Turn the workbook into the two CSVs the importer reads:

```bash
python3 scripts/build-data.py /path/to/2026_IT_Hardware_Asset_Management_Monitoring.xlsx data
```

Load them into SQLite:

```bash
npm run import
```

Start it:

```bash
npm start
```

Then open `http://localhost:3000` and sign in with your `ADMIN_PASSWORD`.

## Giving someone a link

Sign in as admin and use **Links you have given out**. Name the link after
whoever it is for, choose whether they may correct or only look, and send them
the URL. Opening it is all they do — no account, no password, no sign-up.

A link can be withdrawn at any time, which kills it immediately. Changing
`SESSION_SECRET` ends every session at once, including admin's.

| Role | Can do |
|---|---|
| admin | Everything: corrections, links, the change log, and an export that includes network IDs and email addresses. |
| editor link | Corrections and an export without contact details. |
| viewer link | Look and export without contact details. |

Links are bearer tokens: anyone the URL is forwarded to gets the same access.
Give out viewer links freely and editor links deliberately.

## Refreshing from a new workbook

```bash
python3 scripts/build-data.py /path/to/new-workbook.xlsx data
npm run import
```

The import refreshes names, devices, departments and job titles. It leaves
every correction made in the app — type, resigned, note — exactly as it was.
Anyone no longer holding a device is removed; the change log keeps their
history.

## Data and privacy

`register.db` holds names, job titles, departments, work email addresses,
network IDs and device serial numbers. Back it up; it is the only copy of every
correction.

`data/*.csv`, `.env` and `*.db` are all gitignored. Nothing with staff data in
it belongs in the repository — rebuild the CSVs on the machine that runs the
app.

The viewer and editor exports leave out email addresses and network IDs on
purpose; only the admin export includes them.

## Deploying

Put it behind HTTPS and set `SECURE_COOKIES=1`, so session cookies are only
ever sent over an encrypted connection. The app serves plain HTTP itself and
expects a reverse proxy (nginx, Caddy, a cloud load balancer) to terminate TLS.

SQLite in WAL mode handles this load comfortably — hundreds of rows and a
handful of concurrent editors — on one small instance. There is no second
server to run.

## Layout

```
scripts/build-data.py   workbook  -> data/people.csv, data/devices.csv
scripts/import.mjs      those CSVs -> SQLite, keeping corrections
src/db.mjs              schema, queries, the audited update
src/auth.mjs            signed session cookies, admin password, invite links
src/server.mjs          HTTP routes
public/                 the page: index.html, app.js, styles.css
```

## What it deliberately does not do

- **Devices are read-only.** Serials, models and counts come straight from the
  inventory, so the app can never contradict its source. Fix hardware in the
  workbook and re-import.
- **Assets that are not `Active/ Assigned` are left out.** 42 inventory rows
  name a person while marked Available, For Repair, Retired or blank. They are
  records worth cleaning, not devices in someone's hands.
- **Accessories are left out** — iPad keyboards, pencils, mice, adaptors and
  monitors. Only laptops, iMacs and iPads are counted.
