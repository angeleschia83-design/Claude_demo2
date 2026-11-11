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

One dependency — `express` — and Node's own built-in SQLite. Spreadsheet
exports are written by `src/xlsx.mjs` rather than a library. Nothing is
loaded from the internet at runtime, by the server or by the page, and
`npm audit` reports nothing.


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

## Keeping it running on a server

The launchers run the register inside your login session, which is right for
a laptop and wrong for a server: log off and it stops. `service/README.md`
has the fix for both platforms — a scheduled task on Windows, a systemd unit
on Linux. Start at boot, no login needed, restart on failure.

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

**On a server, set `PUBLIC_URL` first.** Links are built from it:

```
PUBLIC_URL=https://devices.example.com
```

Without it the register uses the machine's own network address, which is
right on a laptop and wrong behind a hostname or a proxy — the link would
carry an address nobody outside the office can reach. The sharing panel says
which of the two it is doing.


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

## How a person is identified

Every correction, fold and assignment made in the register is filed against a
holder's id, so what that id means has to never change. It is a hash of the
holder's name as the inventory spells it: the same person keeps the same id
however many people arrive or leave around them.

Until 4.0.0 it was the row's position in an alphabetical list, which meant
that adding fourteen people to the workbook moved 486 of 487 ids onto somebody
else. An import brings an older register forward — matching stored records to
incoming ones by name and moving everything filed against them — and prints a
line saying it has done so.

A person whose name is **respelled** in the workbook gets a new id and appears
as a second record. That is deliberate: the register cannot know whether a new
spelling is the same person or a different one, so it offers the pair under
*Possible duplicate people* and a person decides.

## Refreshing from a new workbook

```bash
python3 scripts/build-data.py /path/to/new-workbook.xlsx data /path/to/new-employee-list.xlsx
npm run import
```

**The import no longer writes over the register.** Into an empty register it
writes everything, because there is nothing to disagree with. After that it
puts the workbook to one side and writes nothing at all. Sign in as admin and
a **From the workbook** section appears, listing every difference:

- fields the workbook would change, ticked for you;
- fields where somebody has already made a correction here — shown with both
  readings and **left unticked**, because taking the workbook's value means
  dropping that correction;
- rows the workbook has that the register does not;
- rows the register has that the workbook does not, which ticking removes.

Press *Take the ticked ones* and only those are written. Everything taken is
in the change log. What you leave stays waiting until you come back to it, or
until you press *Put this workbook aside*.

To take everything without looking — the old behaviour — run
`npm run import -- --apply-all`.

Anyone added in the app is never removed by an import, and neither is an asset
added here.

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

## Exports

Both CSV and Excel, and both always carry **every** holder, whatever is
filtered on screen. The Excel file adds a "Filtered view" sheet when a filter
is on, so the narrowed list is there too without the full one being lost. Only
the admin export includes network IDs and email addresses.

## What the register tracks

Seven kinds of asset: **iPad, Laptop, Mouse, Monitor, iPad Keyboard, iPad
pencil, Headset**. Everything else in the workbook — ethernet adaptors, access
points, switches, IP phones, SDWAN boxes, servers — is left out at import, and
the import prints what it dropped and how many of each.

An iMac is filed under Laptop, with `Imac` as its model: it is a computer
somebody has been given, and leaving it out would stop three machines on one
person's desk being tracked at all.

To change the list, edit `KEEP_TYPES` at the top of `scripts/build-data.py`
and re-import.

## Assets

Every serial of those types, not only the ones in somebody's hands: 1,193
rows, spares and retired assets included.

Click a cell to correct it. **Status, asset type and model are picked from a
list** rather than typed — see below. The serial itself can be corrected too;
it is the asset's identity, so changing it moves everything logged against it,
and it refuses to land on a serial already in the register. One serial is one
piece of hardware.

**Add an asset** is for hardware that arrives between workbooks. It is kept
when the next workbook is imported, which would otherwise not know about it.

## Taking an asset off the register

**Take it off** on any asset row that is in nobody's hands. It keeps the row
and its history, drops it out of every count and list, and stays off through
later imports — which is why it is offered instead of deleting: a deleted
workbook row comes back at the next import. Admins put one back from the list
under the table.

**Delete it for good** appears only for an asset added here by mistake, which
has no workbook row to come back from.

Either way the asset must be in nobody's hands first, so the record of who had
it is not lost along with it.

## The words people pick from

Status, asset type and model are lists, seeded from whatever the workbook
already used — nothing is named in advance. Adding a word is deliberate, is
recorded in the change log, and is refused if it only differs from an existing
one by spelling or case.

That is the whole point: `Retired/Decommissioned` and `retired/decommision`
were two statuses in the workbook, and the second one made an asset vanish
from every count. The list makes that impossible to repeat.

A status also carries **can be handed out**. Statuses that read as hardware
nobody can issue — retired, for repair, for checking — start with it off, and
an admin can change any of them. Assigning something at one of those statuses
stops and asks for a ticket number.

## Handing hardware out

Each asset row has **Hand it out** or **Take it back**.

Handing out stops and asks for a ticket number when any of these is true:

- the asset is already assigned to somebody else;
- the person already holds another asset of the same kind — a second laptop;
- the asset's status is not one that can be handed out;
- the person is marked resigned.

The reason is spelled out on screen. Give a ticket number and it proceeds, and
**the ticket is recorded against every line it writes** in the change log, so
an exception can always be traced back to the decision that allowed it.

Taking something back puts it to *Available* and clears the holder.

Either way the holder's own row is worked out again from the assets
themselves, so the laptop and iPad columns on the Holders table can never
drift from what the Assets table says.

## One person entered twice

The rules that decide whether two names are one person live in
`src/name-match.mjs`, and only there. The dashboard and the shared HTML copy
use generated versions of that file — they carry a do-not-edit header, and
`offline/build-name-match.py` rewrites them. Change the source and
regenerate; never edit a copy, or the three surfaces disagree about who is a
duplicate, which has happened.


Holders come from assignee names typed into the inventory workbook, so one
person typed two ways is two records with some hardware each. **Possible
duplicate people** proposes the pairs and says why; you decide.

- **Keep <name>** folds the other record into that one: its hardware moves
  across, anything only it knew is carried over, and it stops being a holder.
- **Not the same person** dismisses the pair for good.
- **Fold all N pairs** does the lot in one go. For each pair it keeps the
  record HR's own employee list spells that way — the register remembers how
  each name matched when the data was built — then whoever holds more
  hardware, then the fuller name. It lists every decision afterwards, and each
  one can still be put back on its own.

No hardware leaves the register when a record is folded: it all moves onto the
record kept.

Folding, not deleting. The workbook goes on producing both spellings, so a
deleted record returns at the next import with its hardware attached; a folded
one does not. Nothing is destroyed, so an admin can put a record back from the
sharing section — the hardware stays where it was moved to.

**Deleting** works on a record typed into the register by mistake, while it
holds nothing. Admins see those under *Records added here*. A record that came
from the workbook cannot be deleted, and the register says why.

## Adding somebody who joined between workbooks

**Add a person**, under the holders table. They get an id of their own (`N001`
and up), they are never removed by an import, and they can hold hardware
straight away — hand it to them from the Assets section.

Searching the holders for somebody who is not there offers the same thing on
the spot: "Nobody here matches *Rina Mendoza*" with a button to add them under
that name.

When a later workbook does know them, the two records appear as a duplicate
pair under *Possible duplicate people* and fold together, hardware and all.

## Changes from a colleague

The offline HTML copy of this register runs from a file, with no connection to
anything. Whoever you send it to corrects it in their own browser and hands the
result back — **Save them as a file** gives them a small `.txt` to attach, and
**Copy my changes** gives them the same thing to paste into an email.

In the register, admins and editor links get a **Changes from a colleague**
section. Drop the file in, or paste the message, and press *See what it would
change*. Nothing is written yet: every change is listed as a before-and-after,
and you tick what to apply.

Each line is one of four things:

| | What it means |
| --- | --- |
| **to apply** | The register still holds what their copy started from. Ticked for you. |
| **changed here too** | Somebody corrected the same field here since their copy was made. Both readings are shown and the line is left unticked, because a person has to decide. |
| **already done** | The register already says what they say. |
| **naming nobody here** | No holder of that name — or their copy has a different person under that record, which means it is an old export. |

A hand-back carries corrections to the **assets** as well as to people —
status, model, asset type, age, host name and remark, keyed by serial. They
appear in the same list, judged the same way.

Applied changes go through the same path as a correction typed into the page,
so each one is in the change log, under both names: whoever made it and
whoever let it in. Applying the same file twice changes nothing the second
time.

A long block can be damaged in transit — email wraps lines and adds `>` to
forwarded ones — and the register reads through both. The file cannot be
damaged that way, so prefer it for anything more than a handful of changes.

## What has changed lately

At the top of the page, for admins and editor links: the last eight changes,
who made each one and how long ago, over a line that reads *4 changes today,
11 this week by 3 people. 212 in all.* **See the whole log** jumps to the
searchable log below.

Every holder row also says who touched it last, and when, on hover.

## The change log

Every correction, with who made it, when, and what the value was before. Admins
and editor links can read and export it; viewer links cannot. Each entry names
the person by the label on the link you gave them.

## Worth putting right

A section that lists what the inventory cannot be taken at face value on:
serials listed twice, assets with no status, laptops and iPads with no model,
statuses used once or twice, assets marked assigned with nobody named, holders
with no type, holders on neither HR sheet, assets with no age.
It is counted from the rows, so it keeps itself up to date.

## The asset summary

The register answers "who holds what". The asset summary answers "what do we
own", and covers everything with a serial number: accessories, spares, network
kit and retired assets as well as the laptops and iPads people hold.

Every figure is counted from the inventory rows. Nothing is named in advance,
so a model, status or asset type that has never been seen appears on its own.
That is the whole point of it: the spreadsheet it replaces counted with
COUNTIFS against model and status names typed into the formulas, so anything
spelled differently, or simply new, was dropped without a word. Nineteen
laptops and twelve iPads were missing from it that way.

A line above the tables compares the total counted against the number of
assets held, and says so if they ever differ.

## What it deliberately does not do

- **Devices are read-only.** Serials, models and counts come straight from the
  inventory, so the app can never contradict its source. Fix hardware in the
  workbook and re-import.
- **Assets that are not `Active/ Assigned` are left out.** 42 inventory rows
  name a person while marked Available, For Repair, Retired or blank. They are
  records worth cleaning, not devices in someone's hands.
- **Accessories stay out of the holder register** — iPad keyboards, pencils,
  mice, adaptors and monitors. Only laptops, iMacs and iPads count as held.
  They are all in the asset summary.
