# Device register — what it is, and what running it involves

Version 5.2.0, 20 November 2026. For review before it is put on a server.
Everything below can be checked against the code; the last section says how.

---

## What it does

Holds who in the company has which laptop or iPad, and the hardware
inventory behind it. It replaces keeping the asset tracker by hand in Excel.

As of the 9 November workbook and HR's 30 October list: **498 staff records,
1,195 assets, 553 of them in somebody's hands.** Thirteen pairs of duplicate
names have since been folded together, leaving 485 people.

It was built from two files the company already keeps — the IT Hardware
Asset Management workbook and HR's employee list — and it is still built
from them: the import reads those two spreadsheets and nothing else.

## How it was built

Written with Claude (Anthropic's assistant) against the company's own
workbooks, over a series of sessions. Every line of it ships as plain text in
the zip and is also kept in the company's own GitHub repository; there is no
compiled artifact and no minified bundle, so what runs on the server is what
you can read. Claude is not involved at runtime: the application makes
no AI calls, holds no API key, and does not need one.

## What it runs on

| | |
| --- | --- |
| Runtime | Node.js 22.5 or newer |
| Dependencies | **One**: `express` 4.22.3 (MIT). 73 packages in the tree, all MIT (70), ISC (2) or BSD-3-Clause (1) |
| `npm audit` | **0 vulnerabilities** |
| Storage | A single SQLite file, through `node:sqlite`, which is part of Node itself |
| Build step | None. No bundler, no transpiler, no framework, no minification |
| At import time | Python 3 with `openpyxl`, run once by IT to read the two spreadsheets |

Nothing is compiled, so no C++ toolchain is needed and nothing is fetched at
build time. Reading and writing Excel files at runtime is done by 180
lines in `src/xlsx.mjs` rather than by a library, which is how the dependency
count got to one.

## What leaves the server

**Nothing.** The application makes no outbound network requests of any kind:
no telemetry, no update checks, no error reporting, no AI calls.

The browser page loads nothing from the internet either — no CDN, no web
fonts, no analytics. It uses the fonts already on the machine. Every response
carries these headers, so a browser enforces it even if a later change
forgets:

```
Content-Security-Policy: default-src 'self'; img-src 'self' data:;
  style-src 'self'; script-src 'self'; form-action 'self';
  frame-ancestors 'none'; base-uri 'none'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
```

This means the server needs **no outbound internet access at all** to run.

## Who can get in, and how

**One admin password**, set in `.env`, never stored in the database and
never written to the repository. Compared in constant time. After five wrong
attempts from one address the address waits, and the wait doubles to a
maximum of fifteen minutes.

**Invite links** are how everybody else gets in. An admin names a link,
chooses what it allows, and sends it:

- *can correct* — change records, hand hardware out, take it back
- *look only* — read, search and export; every control that writes is gone

Whoever opens the link is in, with nothing to install and no account. Each
link can be withdrawn on its own; changing `SESSION_SECRET` ends every
session at once.

**Sessions** are cookies signed with HMAC-SHA256 and nothing else — no
server-side session store. `httpOnly`, `SameSite=Lax`, `Secure` when
`SECURE_COOKIES=1`, and they expire after 14 days.

**Every change is recorded**: who, when, the value before and after, and the
ticket number. Handing hardware out, taking it back, resigning somebody,
changing an asset's status or serial, adding or removing a person or an
asset — each refuses to proceed without a ticket number, and that number goes
on every line the change writes. Admins and editors can read and export the
log. It cannot be edited from the application, and nothing in it can be
deleted: a deleted person keeps their name on every line about them.

## The personal data in it

Names, job titles, departments, work email addresses, network IDs and device
serial numbers, for 498 staff.

- Only the **admin** export includes email addresses and network IDs. Editor
  and viewer exports leave both out, and an editor link is never sent either
  value by the application.
- The database file is the only copy of every correction made in the app.
  **It needs to be in the backup schedule.**
- There is no encryption at rest in the application; disk or volume
  encryption is the usual answer and is IT's call.
- `data/*.csv`, `.env` and `*.db` are excluded from the repository. No staff
  data has ever been committed.

## Backups it takes itself

Settings has a *Backups* card. **Back up now** copies every record into a
`backups` folder beside the database, using SQLite's own `VACUUM INTO`, so
the copy is complete and consistent while the register keeps running. It also
backs itself up once a week: when somebody opens the register and the newest
backup is a week old, one is made. The top bar shows when the last backup was
taken and turns red once it is a week old or there is none.

Two things for IT to know: **nothing is ever deleted** from that folder, so it
grows by roughly the size of the database each week and wants an eye on it or
a pruning job; and these copies sit on the same machine as the original, so
they are protection against a bad edit, not against losing the server. The
company backup schedule is still what protects the data.

Restoring is deliberately not a button — it replaces every record, so it is
done by hand with the register stopped. `README.md`, "Backups", says how.

## Risks, and what reduces them

| Risk | Reality | What reduces it |
| --- | --- | --- |
| An invite link is forwarded to somebody it was not meant for | Real. A link is a bearer token: whoever holds it has that access | Name every link for one person or team, withdraw it when it is done, and give *look only* unless somebody needs to correct things. Links are listed with when each was last used |
| The admin password is shared, and there is no 2FA or SSO | Real. One password, one role | Keep it with whoever administers the register, not in a team chat. Rotate from Settings or by editing `.env`. The lockout makes guessing it impractical |
| Someone with the database file has everything in it | Real, as with any file | Normal file permissions and disk encryption; restrict who can reach the server. The `backups` folder beside it needs the same permissions |
| A correction is made in error | Possible, and visible | Every change is in the log with who made it and the ticket number; corrections can be reverted to what the workbook says in one click |
| The database is lost | Would lose every correction made in the app | Back up the SQLite file. The spreadsheets can rebuild the base data but not the corrections |
| A dependency develops a vulnerability | One dependency, so a small surface | `npm audit` is clean today; run it when updating. Express patches are drop-in |
| The import overwrites something | It cannot, by design | An import after the first writes nothing: it stages the workbook, and an admin goes through the differences field by field, with anything that would undo a correction marked and left unticked |
| On Windows, it runs as SYSTEM | True, and deliberate: that is what keeps it up after the person who started it logs off | It is one Node process serving one folder, bound to localhost. If that is not acceptable, the scheduled task can be pointed at a dedicated low-privilege service account instead; the only requirement is write access to the database folder |

**What it deliberately does not do:** send email, reach any external service,
accept file uploads, run scheduled jobs of its own, or expose an API to
anything but its own page.

## What IT needs to do

1. A machine that runs Node.js 22.5+, reachable on the network. One process,
   one file on disk. Or use the included `Dockerfile` and `compose.yaml`.
2. In `.env`:
   - `ADMIN_PASSWORD` — long and unguessable
   - `SESSION_SECRET` — 32 random bytes (the command is in the file)
   - `PUBLIC_URL` — the address people reach it by, e.g.
     `https://devices.example.com`. Invite links are built from this
   - `SECURE_COOKIES=1` when it is served over HTTPS
   - `TRUST_PROXY=1` if a reverse proxy sits in front
3. A hostname and a certificate. It binds to localhost on purpose and
   expects the proxy to terminate TLS.
4. Keep it running across logoffs and reboots. On Windows,
   `KEEP-RUNNING-ON-SERVER.bat` registers a scheduled task that runs at boot
   as `S-1-5-18` (SYSTEM) with no execution time limit, which is what stops
   the window closing when the administrator signs out. On Linux, a systemd
   unit is included.
5. Put the database file and the `backups` folder in the backup schedule, and
   decide how long to keep the weekly copies.
6. Decide who holds the admin password.

Setup is about ten minutes; `README.md` has it step by step, and
`TESTING-ON-YOUR-SERVER.md` is a checklist for the first run.

## Checking the claims above

Each of these can be run against the code:

```bash
npm audit --omit=dev                      # 0 vulnerabilities
npm ls --omit=dev --depth=0               # one dependency: express
npm ls --omit=dev --all --parseable | wc -l   # 74: the project and 73 packages

grep -rnE "fetch\(|https?://" src/        # no outbound calls
grep -rn "fonts.googleapis\|cdn\." public/   # no external resources

curl -sD- -o /dev/null http://localhost:3000/ | grep -i content-security
```

And in a browser with the developer tools open on the Network tab, every
request the page makes goes to the server itself. Nothing else.
