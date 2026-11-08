# Changelog

Versions follow [semantic versioning](https://semver.org): the **major** number
moves when the way you work with the register changes, the **minor** when
something is added, the **patch** when something is only put right.

The running version is shown beside your name in the top right of the page,
and `/api/session` reports it.

## 3.2.0 — 8 November 2026

**One person entered twice.** The register's people come from assignee names
typed into the inventory workbook, so the same person typed two ways becomes
two records, each holding some of their hardware. April Rose Magno-Almario and
April Rose Magno-**Almrario** are one person with four laptops under each
spelling. There are **twelve** such pairs in the current workbook.

A new **Possible duplicate people** section proposes them and says why —
the same words in a different order, a middle name dropped, two spellings 98%
alike — and leaves the decision to a person, because Shaina Brazil and Shaira
Brazil may well be two people.

**Keeping one record folds the other into it**: the hardware moves across,
anything only the folded record knew is carried over, and it stops being a
holder. *Not the same person* dismisses a pair for good.

**Folding rather than deleting, deliberately.** The workbook goes on producing
both spellings, so a deleted record comes back at the next import with its
hardware attached. A folded one does not. Nothing is destroyed either, so an
admin can put a record back from the sharing section — the hardware stays
where it was moved to.

**Deleting is still there where it is safe**: a record typed into the register
by mistake can be removed outright, as long as it holds nothing. Admins see
them listed under *Records added here*. Asking to delete a workbook record
explains why folding is the fix instead.

The dashboard does all of this too. The offline copy lists the pairs without
acting on them — folding needs everybody to see the same thing at once — and a
misspelled name corrected there comes back with the rest.

## 3.1.0 — 8 November 2026

**The shared copies carry the assets too.** The Claude dashboard and the
offline HTML file showed only the 543 devices in somebody's hands. Both now
carry the whole inventory — 1,541 serials, spares, accessories, network kit
and retired hardware included — with the same click-to-edit cells and the same
lists to pick a status, asset type or model from.

- **The dashboard** gets the lot: corrections, the lists, adding an asset,
  adding a person, handing hardware out and taking it back, with the same
  guards and the same ticket rule as the register, and a change log of its
  own. Everything is kept in the page's own store, so what one person does
  everyone sees — which is what makes the guards worth having.
- **The offline file** gets corrections but not assignments. It runs from a
  file with nobody else connected, so two readers could hand the same laptop
  to two people and neither would know. Assigning stays where everybody sees
  the same thing at once.
- **Corrections to assets come back with the rest.** The hand-back now carries
  them, keyed by serial, and the register reads them, shows them as
  before-and-afters beside the holder changes, and applies the ticked ones.

### Fixed

- Quiet buttons — *Export CSV*, *Export Excel* — were white on white in light
  mode on the shared pages. A theme rule for the solid button was more
  specific than the quiet one and took its colour.
- A hidden form laid out with flex showed anyway, because the layout rule
  outranked the browser's own `[hidden]`.

## 3.0.0 — 8 November 2026

**The register becomes the tracker, rather than a view of a spreadsheet.**
Three things changed, and each one closes a way the two used to drift apart.

### Assets can be corrected here

An asset now works the way a holder already did: the workbook's row is the
base, what is set here wins, and an import leaves it alone. Status, model,
asset type, age, host name and remark are all editable. The serial can be
corrected too — it is the asset's identity, so it moves everything logged
against it and refuses to land on a serial already in the register.

**Add an asset** is for hardware that arrives between workbooks, and **Add a
person** for somebody who joined between them. Neither is removed by a later
import.

### Status, asset type and model are picked from a list

Seeded from whatever the workbook already used, so nothing is named in
advance. Adding a word is deliberate and recorded, and is refused when it only
differs from one already there by spelling or case. `Retired/Decommissioned`
and `retired/decommision` were two statuses in the workbook, and the second
one made an asset disappear from every count. That cannot happen again.

A status also says whether it is hardware that can be handed out. Retired, for
repair and for checking start with it off.

### Handing hardware out asks before it does something odd

**Hand it out** on any asset row. It stops and asks for a ticket number when
the asset is already with somebody else, when the person already holds another
of the same kind, when the status is not one that can be handed out, or when
the person is marked resigned. The reason is spelled out, and the ticket is
recorded against every line the assignment writes, so an exception can be
traced back to whoever allowed it.

Taking something back puts it in stock. Either way the holder's laptop and
iPad columns are worked out again from the assets themselves, so the two
tables cannot disagree.

### An import no longer writes over the register

This is the breaking change, and the reason for the major version. Into an
empty register an import still writes everything. After that it writes
**nothing**: it puts the workbook to one side, and a **From the workbook**
section shows every difference — what it would change, what it would add, what
it would remove, and which of those would undo a correction made here. Only
what is ticked is taken. `npm run import -- --apply-all` keeps the old
behaviour for anyone who wants it.

### Also

- The change log now carries assets as well as people, and a ticket column.
  Searching it covers serials and ticket numbers.
- "Worth putting right" gained **marked assigned, with nobody named** — 228
  assets in the current workbook say somebody has them and name nobody.

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
