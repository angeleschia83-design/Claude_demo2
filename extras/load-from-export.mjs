/* Rebuilds a register from the app's own Excel export (device-holders.xlsx).
 *
 * THIS IS NOT THE IMPORT. The register is meant to be built by
 *   python3 scripts/build-data.py <asset-workbook.xlsx> data <hr-list.xlsx>
 *   npm run import
 * which reads the IT asset workbook and the HR list, one row per device, and
 * knows how to stage a workbook for review instead of overwriting anybody's
 * corrections. Use that on a server.
 *
 * This exists for the case where the source workbooks are not to hand and all
 * you have is an export -- to stand a register up and look at it. Two things
 * it cannot do as well as the real import:
 *
 *  - Holder ids come from the whole name, because an export has no separate
 *    surname and given name. build-data.py keys on that split, so a later
 *    real import produces different ids. It relabels by name and carries
 *    corrections across, so this is survivable, but it is a reason not to
 *    treat a register built this way as the system of record.
 *
 *  - An export flattens per holder, so somebody with two laptops has both
 *    models in one cell. Where the serial and model counts agree they are
 *    paired off; where they disagree the cell is left whole rather than
 *    guessed at, and you will see a model like "T14 Gen1; T14 Gen2" in the
 *    fleet chart. The real import never sees this.
 *
 * Usage:
 *   node extras/load-from-export.mjs <device-holders.xlsx> <path-to-app> [--replace]
 *
 * <path-to-app> is the folder holding package.json and src/. --replace is
 * required if the register already has holders in it.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readXlsx } from './xlsx-read.mjs';

const [, , bookPath, appDirArg, ...flags] = process.argv;
if (!bookPath || !appDirArg) {
  console.error('usage: node extras/load-from-export.mjs <device-holders.xlsx> <path-to-app> [--replace]');
  process.exit(2);
}
const appDir = path.resolve(appDirArg).replace(/\\/g, '/');
const replace = flags.includes('--replace');

/* Read the app's own .env the way the app does, so the database lands in the
   same place it would. Tolerates a BOM and trailing spaces. */
const envPath = `${appDir}/.env`;
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '');
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
/* db.mjs resolves a relative DATABASE_PATH against the current directory.
   The app is always started from its own folder so that works there, but this
   can be run from anywhere -- and a relative path then quietly creates a
   second, empty register wherever you happened to be standing. Pin it. */
if (!process.env.DATABASE_PATH) process.env.DATABASE_PATH = `${appDir}/register.db`;
else if (!path.isAbsolute(process.env.DATABASE_PATH)) {
  process.env.DATABASE_PATH = path.resolve(appDir, process.env.DATABASE_PATH).replace(/\\/g, '/');
}
console.log(`database: ${process.env.DATABASE_PATH}`);

const { db } = await import(`file:///${appDir}/src/db.mjs`);
const { seedLists } = await import(`file:///${appDir}/src/assets.mjs`);

const already = db.prepare('SELECT COUNT(*) AS n FROM holders').get().n;
if (already && !replace) {
  console.error(`\nThis register already holds ${already} people. Loading an export over it would `
    + 'replace rows and is not what you want on anything real.\n'
    + 'Re-run with --replace if you are certain, and take a copy of the database first.');
  process.exit(1);
}

const sheets = readXlsx(bookPath);
const rows = sheets.get('Holders');
if (!rows || !rows.length) {
  console.error(`No "Holders" sheet in ${bookPath}. Sheets found: ${[...sheets.keys()].join(', ') || '(none)'}`);
  process.exit(1);
}

const head = rows[0];
const need = ['Holder', 'Type', 'Device', 'Laptop serial', 'iPad serial'];
const missing = need.filter((c) => !head.includes(c));
if (missing.length) {
  console.error(`That sheet is missing the column(s): ${missing.join(', ')}.\n`
    + 'This expects the app\'s own Export Excel output, not the IT asset workbook.');
  process.exit(1);
}

const at = (row, name) => {
  const i = head.indexOf(name);
  return i < 0 ? '' : String(row[i] ?? '').trim();
};
const parts = (v) => String(v || '').split(';').map((s) => s.trim()).filter(Boolean);
const norm = (v) => String(v ?? '').trim().toLowerCase()
  .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const insertHolder = db.prepare(`
  INSERT OR REPLACE INTO holders
    (id, name, base_type, base_resigned, device_status, position, department, unit,
     laptops_held, ipads_held, devices_held, laptop_serial, laptop_model,
     ipad_serial, ipad_model, remarks, label_source, hr_status)
  VALUES (@id, @name, @base_type, @base_resigned, @device_status, @position, @department, @unit,
          @nL, @nI, @n, @lap, @lapM, @ipd, @ipdM, @rem, @src, @hr)`);
const insertDevice = db.prepare(`
  INSERT OR REPLACE INTO devices
    (serial, asset_type, kind, model, status, held, holder_id, holder, age_years)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, '')`);

const seen = new Map();
const collided = [];
const unpaired = new Set();
let people = 0;
let devices = 0;
let resigned = 0;

db.transaction(() => {
  if (replace && already) {
    db.prepare('DELETE FROM devices').run();
    db.prepare('DELETE FROM holders').run();
  }
  for (const row of rows.slice(1)) {
    const name = at(row, 'Holder');
    if (!name) continue;

    let id = `P${crypto.createHash('sha1').update(norm(name)).digest('hex').slice(0, 8)}`;
    if (seen.has(id)) {
      collided.push(`${seen.get(id)} / ${name}`);
      id = `P${crypto.createHash('sha1').update(`${norm(name)}#${seen.size}`).digest('hex').slice(0, 8)}`;
    }
    seen.set(id, name);

    const lap = parts(at(row, 'Laptop serial'));
    const ipd = parts(at(row, 'iPad serial'));
    const isResigned = at(row, 'Resigned').toLowerCase().startsWith('y');
    if (isResigned) resigned += 1;

    insertHolder.run({
      id, name,
      base_type: at(row, 'Type') || 'Unknown',
      base_resigned: isResigned ? 1 : 0,
      device_status: at(row, 'Device') || 'No device',
      position: at(row, 'Position'), department: at(row, 'Department'), unit: at(row, 'Unit'),
      nL: lap.length, nI: ipd.length, n: lap.length + ipd.length,
      lap: lap.join('; '), lapM: at(row, 'Laptop model'),
      ipd: ipd.join('; '), ipdM: at(row, 'iPad model'),
      rem: at(row, 'Inventory remark'), src: at(row, 'Type source'),
      hr: 'on list',
    });
    people += 1;

    /* Pair models to serials only where the counts agree; see the note above. */
    const pair = (list, cell) => {
      const models = parts(cell);
      if (list.length > 1 && models.length !== list.length) unpaired.add(cell);
      return list.map((s, i) => [s, models.length === list.length ? models[i] : (cell || '')]);
    };
    for (const [s, model] of pair(lap, at(row, 'Laptop model'))) {
      insertDevice.run(s, 'Laptop', 'Laptop', model, 'Active/ Assigned', id, name);
      devices += 1;
    }
    for (const [s, model] of pair(ipd, at(row, 'iPad model'))) {
      insertDevice.run(s, 'iPad', 'iPad', model, 'Active/ Assigned', id, name);
      devices += 1;
    }
  }
})();

seedLists();

console.log(`\nloaded ${people} holders and ${devices} devices (${resigned} marked resigned)`);
if (collided.length) {
  console.log(`\n${collided.length} name(s) landed on the same id and were given a separate one. `
    + 'Check whether these are two people or one person twice:');
  for (const c of collided.slice(0, 20)) console.log(`  ${c}`);
}
if (unpaired.size) {
  console.log(`\n${unpaired.size} model cell(s) list a different number of models than serials, so `
    + 'they were left whole and will read as one model in the fleet chart:');
  for (const c of [...unpaired].slice(0, 10)) console.log(`  ${c}`);
}
console.log('\nStart the app and sign in. Remember this came from an export, not the workbook:');
console.log('run the real import when you have the source spreadsheets.');
