# Changelog

Versions follow [semantic versioning](https://semver.org): the **major** number
moves when the way you work with the register changes, the **minor** when
something is added, the **patch** when something is only put right.

The running version is shown beside your name in the top right of the page,
and `/api/session` reports it.

## 2.3.0 — 8 November 2026

**Corrections made in the offline copy can be merged back in.** Until now the
offline HTML file was a one-way street: whoever you sent it to could correct
it, but getting those corrections into the register meant retyping them. They
now hand their changes back as a file (or pasted text), and the register reads
it, shows every change as a before-and-after, and applies only the lines you
tick. Each one lands in the change log under both names — whoever made the
correction and whoever let it in.

- **Three-way, so a correction is never confused with a disagreement.** Their
  copy now records what each change started from as well as what it was made
  into. If the register still holds what they started from, the change is
  clean and ticked by default. If it has moved since, two people edited the
  same field: that line is shown with both readings and left unticked for a
  person to decide.
- **A wrong record cannot be applied quietly.** Their copy carries the name
  the workbook gave each holder. If that does not match the name against the
  same record here — an older export, usually — nothing is applied on the
  record number alone.
- **Email damage is expected rather than fatal.** The block is read back
  through forwarding marks and line wrapping. A file is offered alongside the
  copy button because it cannot break at all.
- The offline file and the shared copy are now built from one source, so a
  fix lands in both.

## 2.2.0 — 8 November 2026

**An export no longer depends on what is filtered.** The dashboard and the
shared copy exported only the rows on screen, so filtering to Sales and
pressing Export quietly left out the 33 holders with no type, with nothing in
the file to say so. Both now export every holder, and put the filtered rows on
a second sheet when a filter is on. The app's own exports always carried
everything and are unchanged.

**A change log anyone who can edit can read.** It was admin-only and buried
under the sharing panel. It is now a section of its own, searchable, showing
up to a thousand entries, with its own CSV export. Editors see it, because it
is the record of what they did; viewers do not.

**"Worth putting right"**, counted from the rows rather than from a list
somebody maintains: serials listed twice, assets with no status, laptops and
iPads with no model, statuses used only once or twice (usually a typo),
holders with no type, holders on neither HR sheet, and assets with no age.

## 2.1.0 — 6 November 2026

**The asset summary moves into the app**, so the spreadsheet tracker no longer
has to be kept by hand.

- The whole inventory is imported now, not only the 543 devices people hold:
  all 1,545 rows, accessories, spares, network kit and retired assets included.
  The holder register is unchanged; it reads the held rows.
- A new section counts every asset by type, status, model and age. Nothing is
  named in advance, so a model, status or asset type nobody has seen before
  appears on its own. The spreadsheet could not do this: its COUNTIFS spelled
  out every model, and silently dropped anything not on the list. That is how
  19 laptops and 12 iPads went missing from it.
- A line above the tables compares what was counted against the number of
  assets, and says so if they ever differ.
- Exports gained four sheets: Assets by type, Laptops and iPads by model,
  Asset age, and Duplicate serials.
- Four serial numbers appear twice in the workbook. A serial is one piece of
  hardware, so each is stored once; the assigned row wins over the spare row,
  and the pairs are listed rather than quietly merged.

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
