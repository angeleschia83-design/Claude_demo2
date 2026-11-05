# Changelog

Versions follow [semantic versioning](https://semver.org): the **major** number
moves when the way you work with the register changes, the **minor** when
something is added, the **patch** when something is only put right.

The running version is shown beside your name in the top right of the page,
and `/api/session` reports it.

## 2.0.0 — 5 November 2026

**Every column can be corrected.** Not just type, resigned and note: a holder's
name, position, department, unit, both serials, both models and the inventory
remark are all editable in place. Click a cell, type, press Enter.

- Device and Units are no longer stored. They follow from the serials, so
  clearing a laptop serial moves the row to "iPad only" and takes the laptop
  count down with it, tiles and charts included.
- A corrected cell is marked and carries a ↺ that puts the workbook's value
  back. Hovering it shows what the workbook said.
- Setting a cell back to the workbook's value by hand clears the correction
  rather than storing an opinion that happens to agree.
- Corrections live together in one JSON column, so adding another editable
  column later needs no migration. Databases from 1.x are folded in on first
  start.
- Exports gained a "Corrected here" column listing which fields were changed.
- New **None** filter, for holders whose serials have all been cleared.

Upgrading from 1.x: replace the files and start it. The database migrates
itself and every correction is carried over.

## 1.6.0 — 5 November 2026

Resignations come from HR's own Resigned sheet, with each last working day,
rather than being inferred from absence. The active roll is searched first, so
somebody who left and came back reads as active. A holder on neither sheet is
left alone: absence is not a resignation.

## 1.5.0 — 5 November 2026

Invite links are built from the server's own network address rather than
whatever is in the admin's address bar, which was usually localhost and so
pointed every recipient at their own machine.

## 1.4.1 — 5 November 2026

The copy-link button says "Press Ctrl+C" when the browser blocks copying,
instead of looking like a button that does nothing. Browsers only allow
copying on https or localhost.

## 1.4.0 — 5 November 2026

Storage moved to Node's built-in SQLite. Nothing is compiled on the machine
that runs this, which means no C++ toolchain and no mismatch between a
prebuilt driver and the Node version in front of it.

**Requires Node 22.5 or newer.**

## 1.3.0 — 4 November 2026

Excel export, in three sheets: Holders with an autofilter, To retrieve for the
people tagged resigned, and Summary. Only the admin export carries network IDs
and email addresses, as with CSV.

## 1.2.0 — 4 November 2026

Sales and HO come from the Unit column of HR's employee list rather than being
read off a job title. A holder HR does not list is recorded as such and left
untagged.

## 1.1.0 — 4 November 2026

A Dockerfile and compose file, and a `/healthz` endpoint for container health
checks.

## 1.0.0 — 4 November 2026

The first working register: holders and their devices from Asset Central
Inventory, an admin sign-in, invite links that need no account, corrections to
type and resigned, an audit log, and CSV export.
