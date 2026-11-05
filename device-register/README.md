# Device register

A shared record of who holds which company laptop or iPad, built from the
IT Hardware Asset Management workbook. People outside the company can be given
a link and make corrections without an account of any kind.

Version history is in [CHANGELOG.md](CHANGELOG.md); the running version shows
in the top right of the page. Upgrading means replacing the files and starting
it again — the database migrates itself and corrections are carried over.

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
- **HR's employee list decides Sales vs HO**, through its own `Unit` column
  (`Sales` / `Support`). It is optional; without it the job title on
  MONITORING_EMPLOYEES is read instead, which is a guess by comparison.
- **MONITORING_EMPLOYEES is the fallback for a job title**, matched by name.
  Nobody enters the register through either sheet.

## Sales, HO, Unknown

| Label | Meaning |
|---|---|
| `Sales` | HR's employee list puts them in the `Sales` unit. Without that list: a job title containing "Financial Advisor". |
| `HO` | HR puts them in `Support`. Without that list: any other job title found. |
| `Unknown` | Neither sheet knows the name. 50 holders start here with the employee list, 78 without it. |

### Who has left

Where HR's export has a sheet named **Resigned**, that sheet is the answer:
those holders come through tagged, with their last working day. The active
sheet is searched first, so somebody who left and came back reads as active
rather than as the departure they returned from.

A holder on neither sheet gets `hr_status: not on list` and nothing more. The
script never tags them, because absence from an HR export is not proof of
departure — it equally describes a contractor, an agency seller or a shared
machine. One such holder is a Bloomberg terminal.

Anything ticked or unticked in the app overrides HR and survives every later
import. Setting it back to agree with HR clears the override rather than
recording a second opinion that happens to agree.

Where the export has no Resigned sheet, every row reads as active and nobody
is tagged.

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
4. **whole name** — nobody shares the surname, so compare full names against
   everyone, at 0.88 or better. This tier also catches names whose halves are
   the wrong way round in the inventory.

The HR export is UTF-8 read as latin-1 in places, so `Bañares` arrives as
`BaÃ±ares`. That is repaired before any comparison; without it 27 people looked
like leavers when they were simply misspelled.

Each holder's `label_source` column records which tier answered, so an inferred
match can always be checked.

## Running it

Requires Node 22.5 or newer, and Python 3 with `openpyxl` for the import step.

There is nothing to compile. Storage is Node's own built-in SQLite, so
`npm install` pulls down plain JavaScript and no C++ toolchain is needed on
the machine that runs this. An earlier version used a compiled SQLite driver,
which has to match the exact Node version it was built for and failed on
anything newer than its prebuilt binaries covered.

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
python3 scripts/build-data.py /path/to/asset-workbook.xlsx data /path/to/Employee_List.xlsx
```

The employee list is optional; leave it off and Sales falls back to reading job
titles.

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
| admin | Everything: corrections, links, the change log, and exports that include network IDs and email addresses. |
| editor link | Corrections, and exports without contact details. |
| viewer link | Look, and exports without contact details. |

Both CSV and Excel are offered. The workbook has three sheets: **Holders**
(every row, with an autofilter on the header), **To retrieve** (only the people
tagged resigned, which is the list to chase hardware with) and **Summary**
(people, laptops, iPads and resignations per type).

Links are bearer tokens: anyone the URL is forwarded to gets the same access.
Give out viewer links freely and editor links deliberately.

## Refreshing from a new workbook

```bash
python3 scripts/build-data.py /path/to/new-workbook.xlsx data /path/to/new-employee-list.xlsx
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

## Running it with Docker

Everything above, in three commands. Still set `.env` first — the container
reads the same file.

```bash
cp .env.example .env
```

Build the CSVs on the host, since the import needs Python and `openpyxl` and
the image does not carry them:

```bash
python3 scripts/build-data.py /path/to/workbook.xlsx data /path/to/Employee_List.xlsx
```

```bash
docker compose run --rm app npm run import
```

```bash
docker compose up -d
```

It listens on `127.0.0.1:3000` — reachable only through a reverse proxy, not
from the network. To expose it directly on a trusted network instead, change
the port mapping in `compose.yaml` to `"3000:3000"`.

`register.db` lives in the `register-data` volume, so it survives rebuilds and
`docker compose down`. It is the only copy of every correction:

```bash
docker run --rm -v device-register_register-data:/data -v "$PWD":/backup busybox \
  cp /data/register.db /backup/register-backup.db
```

To take a newer workbook: rebuild the CSVs on the host, then
`docker compose run --rm app npm run import` again. Corrections are kept.

The image carries no staff data and no secrets — `data/`, `*.db` and `.env` are
all in `.dockerignore`. The CSVs are bind-mounted read-only at import time, the
database lives in the volume, and the environment comes from `.env` at run
time. The container runs as the unprivileged `node` user, and
`GET /healthz` answers Docker's health check without touching the database.

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
Dockerfile              two-stage build, runs as the node user
compose.yaml            the app, a volume for the database, data/ read-only
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
