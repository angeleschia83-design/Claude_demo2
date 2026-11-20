# Device register

Who in the company holds which laptop or iPad, and the hardware inventory
behind it. It replaces keeping the asset tracker by hand in Excel.

The running version is shown beside your name in the top right of the page.
`device-register/CHANGELOG.md` says what changed and when.

## What is where

| | |
| --- | --- |
| `device-register/` | The application. One Node process, one SQLite file, one dependency |
| `device-register/src/` | The server: routes, database, assets, people, import, Excel |
| `device-register/public/` | The page. No framework, no bundler, no build step |
| `device-register/scripts/` | `build-data.py` reads the two workbooks; `import.mjs` brings them in |
| `device-register/service/` | A systemd unit, for a Linux server |
| `extras/` | Small helpers the `.bat` files call — diagnostics, backups, task XML |
| Root `.bat` files | What people double-click on the Windows server |
| `FOR-THE-IT-HEAD.md` | What it is, what it runs on, what leaves the server, and the risks |

Staff data never goes in here. `data/*.csv`, `.env` and `*.db` are ignored;
rebuild the CSVs from the workbooks with `scripts/build-data.py` on the
machine that runs the app.

## Running it

On a laptop, to look at it:

```bash
cd device-register
npm install
npm start
```

On a Windows server, so it stays up after whoever started it logs off:
right-click `KEEP-RUNNING-ON-SERVER.bat` and **Run as administrator**.
`KEEPING-IT-RUNNING.md` explains what that registers and how to undo it.

On a Linux server, `device-register/service/README.md` has the systemd unit.

`device-register/README.md` is the full setup, including `.env`, invite links
and backups. `TESTING-ON-YOUR-SERVER.md` is the checklist to run after an
upgrade, and `READ-THIS-FIRST.txt` is the upgrade note for the current
version.

## Requirements

Node.js 22.5 or newer — the database goes through `node:sqlite`, which is
part of Node itself. Python 3 with `openpyxl` is needed only when reading a
new workbook.
