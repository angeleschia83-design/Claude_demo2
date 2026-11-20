EXTRAS — not part of the application
====================================

Two small tools that live outside the app. Nothing in device-register/ imports
them, the app runs without them, and you can delete this folder entirely.

They exist because of one specific situation: you have an Excel file the app
exported, you do not have the source workbooks to hand, and you want a working
register to look at. That is a demonstration, not a deployment.


THE REAL IMPORT IS STILL THE REAL IMPORT

  python3 scripts/build-data.py <asset-workbook.xlsx> data <hr-list.xlsx>
  npm run import

That reads the IT Hardware Asset Management workbook and the HR employee list,
one row per device, and knows how to hold a new workbook to one side for
somebody to review rather than writing over corrections people have made. Use
it on a server. Everything below is a lesser thing.


load-from-export.mjs

  node extras/load-from-export.mjs <device-holders.xlsx> <path-to-app> [--replace]

  Rebuilds a register from the app's own "Export Excel" output. <path-to-app>
  is the folder holding package.json and src/. It reads that folder's .env to
  find the database, so it writes where the app would.

  It refuses to run if the register already has people in it. Pass --replace
  only if you are certain, and copy the database first.

  Two things it cannot do as well as the real import, both consequences of an
  export being a summary rather than a source:

    Holder ids are built from the whole name, because an export has no
    separate surname and given name to key on. build-data.py keys on that
    split, so a later real import will produce different ids. It relabels by
    name and carries corrections across, so nothing is lost -- but it is a
    reason not to let a register built this way become the system of record.

    An export flattens per holder, so somebody with two laptops has both
    models in one cell. Where the serial and model counts agree they are
    paired off. Where they disagree there is nothing reliable to pair, so the
    cell is left whole and reads as a single model like "T14 Gen1; T14 Gen2"
    in the fleet chart. The tool prints every cell this happened to. On the
    485-row export this was tested against, 7 cells were affected.

  It also prints any two names that landed on the same id, which is worth
  reading: that is either two people or one person entered twice.


xlsx-read.mjs

  node extras/xlsx-read.mjs <file.xlsx>

  Prints the sheets, their headers and first row. Also the reader that
  load-from-export.mjs uses. No dependencies -- it unzips and parses the
  spreadsheet itself, so it runs wherever the app runs.

  It does not handle ZIP64 (files over 4GB), encrypted workbooks, or dates:
  a date cell comes back as the underlying serial number, not a date.


Both need Node 22.5 or newer, the same as the app.
