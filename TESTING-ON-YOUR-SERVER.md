# Testing 5.2.0 on your server

The short list to run once you have upgraded, following READ-THIS-FIRST.txt.
Each step says what you should see. Nothing here changes a real person's
record: the checks use a test person and a test asset you add, and then
delete. Use a ticket number like `TEST-1` throughout.

## Before you start

- **Back up `register.db`**, and the whole old folder. That is your way back.
- Node must be 22.5 or newer: `node --version`.

## 1. It starts, and it is the new version

```
curl http://localhost:3000/healthz
```

Expected: `ok`. Sign in: the top right says **v5.2.0**.

## 2. Nothing you had is missing

- **People** and **Assets**: the same counts as before the upgrade.
- **Change log**: your old entries are there, newest first.
- **Access links**: every link is listed and still opens.

## 3. Tickets, and the pop-up for somebody holding nothing

1. **People -> Add a person**: name `Test Leaver`. Expected: it asks for a
   ticket number and will not add without one.
2. Tick **Resigned** on `Test Leaver`. Expected: the pop-up opens and says
   they hold nothing; **Mark resigned** stays greyed until there is a ticket.
3. **Add a person** named `test leaver` again. Expected: refused, with a note
   saying Test Leaver is already there. Try `Test Leavr`: a note lists Test
   Leaver as the likely match, with *Add them anyway*. Cancel.
4. As admin, untick it. Expected: it asks for a ticket, then the row is no
   longer greyed.

## 4. To retrieve, on a test asset

1. **Assets -> Add an asset**: serial `TEST-0001`, with a ticket. Then
   **Hand it out** to `Test Leaver`, with a ticket.
2. On **People**, tick **Resigned** on `Test Leaver`, choose **To retrieve**,
   save. Expected: a notice under the bar names `TEST-0001`; **Show them**
   opens Needs attention with that row lit up. On People the row is greyed
   and says *1 to retrieve*; on Assets, `TEST-0001` says *To retrieve since*
   today.
3. Open the register on a second computer with an editor link. Expected:
   `Test Leaver` is greyed there and cannot be edited.
4. **Needs attention -> It's back** on `TEST-0001`, choose **Available**,
   type the ticket, **Take it back**. Expected: the People row says
   *all back*.

## 5. Admin deletes, and the log

1. **Assets**, `TEST-0001` -> **Take it off**, tick **Delete it for good**.
2. **Settings -> Delete a person**, find `Test Leaver`, **Delete**.
3. **Change log**: set **From** and **To** to today. Expected: only today's
   lines, each with your ticket, and `Test Leaver` still named on them.
   **Export the log** exports those lines only.

## 6. Export for audit

On **Assets**, set *Where it is* to *In stock* and press **Export for audit**.
Expected: an Excel file listing only what the table shows, ending in empty
**Found** and **Notes** columns, with a second sheet saying it was narrowed to
*In stock*.

## 7. Backups

As admin, open **Settings -> Backups**. Expected: a backup marked *weekly, made
automatically*, made the first time the register was opened, and the top bar
showing its date. Press **Back up now**: a second one is listed, *made here*.
On the server there is a `backups` folder beside `register.db`. Download one
and keep it somewhere other than the server.

## 8. The dashboard

**Laptops and iPads owned** shows totals for every laptop and iPad, not only
the ones out. On a second computer, change something; within half a minute
the first computer's **What has changed lately** shows it, without a reload.

## The two new dates

On **Assets**, press **Add an asset**. There are two more boxes, *Invoice
date* and *Purchase date*, both marked optional and both calendars. Add one
asset with both filled in and one with neither; both should be accepted.

Find the asset you gave dates to. Its *Invoice date* and *Purchase date*
columns show what you typed. Click one, change it, press Enter: the new value
stays. Press **Export for audit** — the spreadsheet has both columns.

Then import a workbook as you normally would, or wait until you next do: the
two dates are not in the workbook and the import leaves them exactly as you
typed them.

## If you need to go back

Stop the app, put the old folder back from your backup, including the
`register.db` you backed up, and start it. 5.2.0 adds no tables; it adds two
empty columns to `devices`, and 5.1.0 reads a database 5.2.0 has used without
complaint — it simply does not show the two dates.

## What was tested before this reached you

Against a register of made-up people: 54 automated tests, and every button
walked through in a browser as an editor link, as admin and as a viewer. Not
tested: your server, your data, Task Scheduler and the Docker route.
