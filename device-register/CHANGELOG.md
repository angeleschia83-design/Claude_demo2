# Changelog

Versions follow [semantic versioning](https://semver.org): the **major** number
moves when the way you work with the register changes, the **minor** when
something is added, the **patch** when something is only put right.

The running version is shown beside your name in the top right of the page,
and `/api/session` reports it.

## 5.2.0 — 20 November 2026

**An asset can carry its invoice date and its purchase date.** Both are
optional boxes on *Add an asset*, and both are columns on the Assets table
that an admin can fill in or correct later by clicking the cell, the same way
as a host name or a remark. They are in the audit export too.

Neither date comes from the workbook, so an import never overwrites one: what
somebody types here stays typed. A date is kept as YYYY-MM-DD, and the boxes
are calendars rather than free text, so nothing can be stored that reads as
3 April in one place and 4 March in another.

Two nullable columns are added to `devices` the first time 5.2.0 starts. An
older build reads the database afterwards without complaint; it simply does
not show the two dates.

**Fixed: pressing Enter in an Assets cell undid the edit it had just made.**
The cell saved the new value, then opened a second box — still holding the
old one — which wrote it back the moment focus moved, all under a "saved"
message. Every correction typed into the Assets table and committed with
Enter was lost this way; clicking away instead of pressing Enter was not
affected, and the People table was never affected. Both values are in the
change log, so anything lost to this can be found there.

## 5.1.0 — 13 November 2026

**A ticket number on every change an audit follows.** Handing out, taking
back, *It's back*, resigning somebody (decide later included), changing an
asset's status or serial, adding or taking off an asset, putting one back,
adding or deleting a person, unticking Resigned and deleting a pick-list word
now all need one, and it goes on every line the change writes. The register
asks for it in a small box, offering the last number typed, and refuses
without it. Correcting a name, a position or a remark does not need one.

**Ticking Resigned always opens the pop-up**, for somebody who holds nothing
too: it is where the ticket is asked for. Before, a person with nothing on
their name was ticked without a word.

**You can see what is waiting without going looking.** After a resign a notice
says what was tagged To retrieve, with **Show them**, which opens Needs
attention with those rows lit up. A leaver's row on People says *2 to
retrieve*, *1 not decided* or *all back*, and an asset waiting to come back
says *To retrieve since* the day it was asked for. Assets has a *Waiting to
come back* filter.

**A leaver's record is locked.** Their row is greyed, and only an admin can
change it or untick them. An editor can still decide their hardware and take
it back.

**Admin can delete.** Anybody who holds nothing, from Settings, *Delete a
person*; any asset nobody holds, from *Take it off*; and any word on a pick
list that no asset uses. Nothing in the change log can be deleted: a deleted
person keeps their name on every line about them.

**Light or dark, your choice.** A button in the top bar switches between
them, and the browser remembers it. Until it is pressed, the register follows
the computer's own setting, as before.

**Back up from the page.** Settings has *Backups*: **Back up now** copies every
record (people, assets, corrections, resigns and the change log) into a
backups folder beside the database, while the register keeps running. Each
one can be downloaded, to keep somewhere other than the server, and the card
says how to put one back. It also backs itself up every week: when the
register is opened and the newest backup is a week old, it makes one. The bar at the top shows when the last backup was
made, for admins and editor links, and turns red once it is a week old or
there is none. Backups made by the workbook import count too.

**Adding something that is already there says so.** Adding a person or an
asset already in the register is refused with a note saying who or where it
is: their department and what they hold, who has the asset, or that it was
taken off the register and can be put back. A near miss (a name with a letter
out, surname first or a middle name more, or a serial with different dashes
or spaces) lists the likely match first; *Add anyway* adds it when they really
are two.

**Export for audit**, on the Assets tab: an Excel list of exactly the assets
the tab is showing, with empty **Found** and **Notes** columns to fill in while
walking round, and a second sheet saying what it was narrowed to.

**The change log filters by date**, From and To, and *Export the log* exports
what the filter shows.

**Laptops and iPads owned**, a new dashboard card: every one on the register,
not only those handed out, split into with people, ready to hand out and
elsewhere, with what elsewhere means.

**Faster, and up to date without refreshing.** The server compresses its
answers, a tenth of the size over the network. The page reads the
to-retrieve list once instead of three times, and asks for the data-quality
list only while Needs attention is open. *What has changed lately* updates
after every change, and every half minute the page asks whether anybody else
changed something, reloading only when they have, so one person's change
reaches everyone's screen without anybody pressing refresh.

**Put right from a security review.** Handing out hardware, folding two
records and adding a person used to answer an editor link with the person's
email and network ID; they no longer do. The change log hides the old and new
value of an email or network ID change from editor links. Applying changes
pasted from the offline copy now asks for a ticket like every other audited
change, and an editor link's paste can no longer change a resigned person.

## 5.0.0 — 12 November 2026

**One tab per job.** The page had grown into one long scroll of fifteen
sections, and reaching the invite links meant scrolling past everything else.
It is eight tabs now: Dashboard, People, Assets, Needs attention, Import,
Access links, Change log and Settings. A tab shows only when the person signed
in can use something on it, the address names it so it can be bookmarked, and
the page reopens on the last one used.

**A leaver's hardware is decided when they leave.** Ticking somebody resigned
who holds anything opens a pop-up with every piece on their name. Each gets
one of four answers: to retrieve, which keeps it on their name until it is
back, or available, decommissioned or defective, which take it off. It all
saves together or not at all, a ticket number goes on every line it writes,
and if somebody else changed their hardware while it was open, it says so
instead of saving half of it. Decide later marks them and leaves the hardware
for later.

**Needs attention** lists every leaver still holding hardware nobody has
decided about, HR's leavers included, and everything waiting to come back with
the day it was asked for. Settings has *When someone resigns*, where an admin
picks the status word each answer writes; until then the closest word on the
list is used, and the plain word is added the first time nothing fits.

**The dashboard is each person's own.** Every card can be hidden or moved,
filters narrow every card that can take them, and a period narrows what has
changed lately. This browser remembers it. Five cards are new: assets by
status, by department, to retrieve, defective, and resigned but not decided.

**A new look.** Warm paper, one calm green for every signal, a leaver's
hardware in grey rather than red, serials set like a label, the totals as one
ruled line. It follows the computer into dark mode. Every control now shows
where the keyboard is, and nothing scrolls sideways on a phone.

**After an upgrade, the page is the new one.** A browser kept the page for an
hour and could show the old one, with a mix of old and new scripts, after an
upgrade. It now checks for a newer page every time, and the scripts carry the
version in their address.

Nothing the register already did has changed: the database, imports, exports,
links, hand-out rules, duplicates and the change log all work as before, and
the database needs no step to upgrade.

## 4.5.0 — 10 November 2026

**The rules for matching two names are written once now.** They used to
exist three times — in the register, in the dashboard, and inside the shared
HTML copy — and in 4.2.0 that cost a release: the fix that catches *Darly
joice Cabel* against *Daryl Joyce Cabel* went into the register, and the
dashboard carried on missing the pair until somebody noticed by eye.

`src/name-match.mjs` is the one copy. The browser versions are generated
from it and carry a do-not-edit header; `offline/build-name-match.py` writes
them. The dashboard loads the generated file, and the shared copy and the
offline file inline it at build time.

`src/duplicates.mjs` drops from 190 lines to 57 — it finds pairs and shapes
them for the page, and asks `whyTheyMatch` whether a pair is one.

Nothing a person sees changed: the same twelve pairs, in the same order,
with the same reasons, on all three surfaces.

## 4.4.0 — 10 November 2026

Everything here came out of reading the code the way a security reviewer
would, before it goes to one.

**One dependency, no findings.** `npm audit` reported five, four of them
cleared by moving express 4.21.1 to 4.22.3. The fifth was the spreadsheet
library, with no fix available — both advisories about parsing a hostile
workbook, which this never does: it only ever *writes* spreadsheets, and the
workbook is read by Python at import time. Rather than argue that in every
review, the library is gone. Exports are written directly now, in
`src/xlsx.mjs` — an .xlsx is a zip of XML parts, and a flat table needs five
of them. Checked by reading the result back with two independent readers.

    before: express + xlsx, 76 packages, 5 vulnerabilities
    after:  express,        67 packages, 0 vulnerabilities

**Nothing is loaded from the internet.** The page fetched its typeface from
Google on every view. An internal register that calls out to a third party
on every page load is a thing to have to explain, and it breaks on a server
with no way out. It uses the fonts already on the machine now.

**A content security policy**, plus `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options` and `Cross-Origin-Opener-Policy`. The
policy is `default-src 'self'` with no inline scripts or styles allowed —
the seven inline `style` attributes moved into the stylesheet so it could be
that strict.

**A lockout on the sign-in.** Five wrong passwords from one address and that
address waits, doubling to a quarter of an hour; a right one clears it. Set
`TRUST_PROXY=1` behind a proxy so it counts the caller and not the proxy.

**The column name in the one statement that interpolates one** is now
checked against the list of columns the workbook owns. It was already built
server-side rather than sent by a caller; this keeps it that way whatever
changes around it.

## 4.3.0 — 10 November 2026

**Invite links now carry the address people actually use.** They were built
from the machine's own network address, which is right for a laptop on the
office wifi and wrong for a server: a link reading `http://10.80.103.201:3000`
is a link nobody outside the office can open. Set `PUBLIC_URL` in `.env` to
the address the register is published at and every link is built from it:

```
PUBLIC_URL=https://devices.example.com
```

The sharing panel says which of the two it is doing, and tells you to set
`PUBLIC_URL` when it is guessing.

Nothing else about the links changed — they have worked since 2.0.0 and still
do: name a link, choose *can correct* or *look only*, send it. Whoever opens
it is in, with nothing to install, no account and no password, and every
change they make is logged under the name you gave the link.

## 4.2.0 — 10 November 2026

**The duplicate finder was walking past transposed letters.** *Darly joice
Cabel* and *Daryl Joyce Cabel* are one person. The likeness measure compares
runs of letters in order, which scores that pair 0.53 and says nothing — so
the register held her twice until somebody spotted it by eye and tried to fix
it by emptying one of the names.

A pair of names the same length, word for word, now also matches when each
word is the same letters in a different order or one letter out. The reason
it gives names the words:

> The same name typed two ways — "darly" against "daryl", "joice" against
> "joyce". Same letters in a different order, or one letter out.

Twelve pairs across 498 names now, up from eleven, with no new false matches.
It also sharpens what it says about four pairs it already found, *Oddette*
against *Odette* among them.

## 4.1.0 — 10 November 2026

**What has changed lately**, at the top of the page. The full log answers
"what happened to this serial"; this answers the question people actually
open the register with — has anything moved since I last looked, and who
moved it. The last eight changes with who made them and how long ago, over a
line that reads *4 changes today, 11 this week by 3 people. 212 in all.*
Admins and editor links see it; viewer links do not.

Every holder row also carries **who touched it last** and when, on hover, and
the log's field names now read correctly for assets — an asset's `status` is
its Status, not the holder's Device column.

**The register tracks seven kinds of asset.** iPad, Laptop, Mouse, Monitor,
iPad Keyboard, iPad pencil and Headset. The workbook's 349 ethernet adaptors,
access points, switches, IP phones, SDWAN boxes, servers and so on are left
out — none of them was in anybody's hands, and carrying them only made the
counts harder to read. The import names what it dropped and how many:

```
349 assets left out, of types the register does not track:
    250  Ethernet Adaptor
     25  Type-C Adapter
     ...
```

An **iMac is a computer somebody has been given**, so it stays, filed under
Laptop with Imac as its model. Three of them are on one person's desk; a list
taken literally would have stopped tracking them.

1,193 assets now, 553 of them out with somebody. The holder count does not
move: 498.

## 4.0.1 — 9 November 2026

**One missing space was about to lose a holder.** This workbook writes
`Active/Assigned` where every earlier one wrote `Active/ Assigned`, and the
import matched that text literally to decide whether an asset is in somebody's
hands. So iPad YXQ44XK934 would have read as sitting in stock with Lorena Mae
Papa's name on it, and she would not have been a holder at all.

Spacing and case no longer come into it. And where the same status is spelled
two ways, the spelling the workbook uses most wins, the others are written as
that, and the import says how many it changed:

```
1 asset had a status spelled 'Active/Assigned' -> 'Active/ Assigned'
```

Spellings that differ by more than spacing and case are left alone —
`retired/decommision` against `Retired/Decommissioned` is a real typo for
somebody to fix in the register, not noise to paper over.

## 4.0.0 — 9 November 2026

**A holder's id now means the same person for ever.** It used to be the row's
position in an alphabetical list. The November workbook added fourteen people,
and that moved **486 of the 487 ids onto somebody else** — every correction,
every fold and every assignment in the register is filed against an id, so all
of them would have landed on the wrong person.

An id is a hash of the holder's name now: fourteen people arrived, nobody
else's id moved. Checked both workbooks side by side — 483 people in common,
**zero** id changes, no collisions in 497.

**An existing register is carried forward on its next import.** Stored records
are matched to incoming ones by name, the record takes the new id, and
everything filed against it moves too — corrections, folds, assignments, the
audit trail. The import says so when it happens. Tested on a register built
the old way, carrying a note and a fold: both came through attached to the
right person.

A person whose name is **respelled** in the workbook still gets a new id and
shows up as a second record. That is on purpose — the register cannot know
whether a new spelling is the same person — and it is what *Possible duplicate
people* is for.

### The November workbook

Nothing was added or removed: the same 1,542 serials. What changed is who
holds them.

- **16 assignments** — 15 pieces of hardware went from *Available* to
  *Active/Assigned*, one went to *retired/decommision*.
- **14 people** now named on hardware who were not before, 4 no longer named.
- Among them two the register would rather you saw: *Allen Delas Llagas* has
  become *Allen De Las Llagas*, and a holder recorded only as *Santos* is now
  *Edmar Jose Santos*.
- 3 iMacs that had no model have one.
- 497 holders, 1,544 rows, 552 devices in people's hands.

Eleven duplicate pairs remain and have been folded, which leaves **486
holders**. *Mae Legaspi*, folded in 3.3.0, is no longer named on any asset at
all, so her pair is gone of its own accord.

### Also

- A duplicate pair now carries how each name matched HR's list, so whatever
  shows the pair can say why one record is the one to keep rather than working
  it out again.
- The note to IT claimed holder ids were "stable across imports". They were
  not. It says what they are now.

## 3.5.0 — 9 November 2026

**An asset can be taken off the register**, the same way a duplicate person
can be folded away — and for the same reason. Deleting a workbook row here
would last until the next import and no longer, so **Take it off** keeps the
row, keeps its history, and keeps it off the register through every later
import. An admin can put it back.

Deleting outright is still there for an asset **added here by mistake**, which
has no workbook row to come back from.

Either way the asset has to be in nobody's hands first:

> PF2SQEGH is still with Siegfred Bactung. Take it back first, so who had it
> is not lost along with the record.

An asset off the register is out of the counts, the asset summary and the
data-quality list, and is listed under the table with what it was taken off
for. Verified across a full `--apply-all` re-import: it stays off.

The dashboard does all of this too.

## 3.4.0 — 9 November 2026

**Adding a new joiner is where you would look for it.** The button existed
from 3.0.0, but in the register it sat among the export buttons and in the
dashboard it sat in the Assets section — neither of which is where you look
when somebody joins. It is now **under the holders table**, with a line
saying what it is for.

**And it is offered at the moment you need it.** Searching the holders for
somebody who is not there now answers "Nobody here matches *Rina Mendoza*" —
with a button to add them under that name, already filled in.

Nothing else changed: a person added here gets an id of their own, can hold
hardware straight away, and is never removed by an import. When a later
workbook does know them, the two records show up as a duplicate pair and fold
together.

## 3.3.0 — 8 November 2026

**Fold all the pairs at once.** Going through twelve pairs one at a time is
twelve chances to pick the wrong record. One button does the lot, and says
which record it kept for each and why.

**It picks the record HR's own list spells that way.** The register already
records how each name matched HR's employee list when the data was built —
exactly, by first name, by spelling, or with the name halves swapped. The
record HR spells exactly that way is the real one; the other is what somebody
typed into the inventory. Where HR cannot separate them it keeps whoever holds
more hardware, then the fuller name, then the older record.

On the current workbook that fixes, among others, `Odette` over `Oddette`
Alvarez and `Mayrizalyn Saragoza` over the surname-first `Saragoza
Mayrizalyn` — both of which a simpler rule got backwards.

**No hardware leaves the register.** Every asset held by the folded record
moves onto the one kept: 487 holders become 475, and 543 assets are still out
with somebody, 998 still in stock. Each fold is listed afterwards and each can
be put back on its own.

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
