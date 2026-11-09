/* Loads data/people.csv and data/devices.csv.
 *
 * The first time, into an empty register, it writes them straight in.
 * After that it does not: a workbook nobody has checked can disagree with
 * corrections made in the app, and overwriting them silently is how the
 * register and the spreadsheet drift apart. So a later import puts the
 * workbook to one side and the app shows what taking it would change,
 * field by field, for somebody to pick.
 *
 * Run it with --apply-all to take the lot without looking, which is the
 * old behaviour and occasionally what you want.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const { db, setNote } = await import('../src/db.mjs');
const { stageRows, reconcilePlan } = await import('../src/reconcile.mjs');
const { seedLists } = await import('../src/assets.mjs');

/** RFC 4180: quoted fields, doubled quotes, commas and newlines inside them. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c !== ''));
  return body.map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])));
}

const read = (name) => {
  const file = path.join(root, 'data', name);
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}.\nBuild it first:  python3 scripts/build-data.py <workbook.xlsx> data`);
    process.exit(1);
  }
  return parseCsv(fs.readFileSync(file, 'utf8'));
};

const people = read('people.csv');
const devices = read('devices.csv');

/* A serial number is one piece of hardware, so the same serial twice is one
   asset, not two. Three laptops in the workbook are listed both as a spare
   and as assigned to somebody; the assigned row is the true one, so held
   rows are written last and win. The pairs are recorded either way. */
const seen = new Map();
for (const d of devices) seen.set(d.serial, (seen.get(d.serial) || 0) + 1);
const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([serial]) => serial);
const duplicates = duplicated.map((serial) => {
  const rows = devices.filter((d) => d.serial === serial);
  return {
    serial,
    asset_type: rows[0].asset_type,
    model: rows[0].model,
    statuses: [...new Set(rows.map((d) => d.status || '(blank)'))],
    holder: rows.map((d) => d.holder).find(Boolean) || '',
  };
});
devices.sort((a, b) => (a.held === 'yes' ? 1 : 0) - (b.held === 'yes' ? 1 : 0));

const upsertHolder = db.prepare(`
  INSERT INTO holders (id, name, base_type, device_status, position, department, unit, division,
                       ad_id, email, laptops_held, ipads_held, devices_held,
                       laptop_serial, laptop_model, ipad_serial, ipad_model, remarks, label_source,
                       hr_status, base_resigned, last_working_day)
  VALUES (@id, @name, @base_type, @device_status, @position, @department, @unit, @division,
          @ad_id, @email, @laptops_held, @ipads_held, @devices_held,
          @laptop_serial, @laptop_model, @ipad_serial, @ipad_model, @remarks, @label_source,
          @hr_status, @base_resigned, @last_working_day)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, base_type = excluded.base_type,
    device_status = excluded.device_status, position = excluded.position,
    department = excluded.department, unit = excluded.unit, division = excluded.division,
    ad_id = excluded.ad_id, email = excluded.email,
    laptops_held = excluded.laptops_held, ipads_held = excluded.ipads_held,
    devices_held = excluded.devices_held,
    laptop_serial = excluded.laptop_serial, laptop_model = excluded.laptop_model,
    ipad_serial = excluded.ipad_serial, ipad_model = excluded.ipad_model,
    remarks = excluded.remarks, label_source = excluded.label_source,
    hr_status = excluded.hr_status,
    base_resigned = excluded.base_resigned,
    last_working_day = excluded.last_working_day
`);

const upsertDevice = db.prepare(`
  INSERT INTO devices (serial, asset_type, kind, model, status, held, holder_id, holder,
                       assigned_on, age_years, os, host_name, specs, remarks)
  VALUES (@serial, @asset_type, @kind, @model, @status, @held, @holder_id, @holder,
          @assigned_on, @age_years, @os, @host_name, @specs, @remarks)
  ON CONFLICT(serial) DO UPDATE SET
    asset_type = excluded.asset_type, kind = excluded.kind, model = excluded.model,
    status = excluded.status, held = excluded.held,
    holder_id = excluded.holder_id, holder = excluded.holder,
    assigned_on = excluded.assigned_on, age_years = excluded.age_years,
    os = excluded.os, host_name = excluded.host_name, specs = excluded.specs, remarks = excluded.remarks
`);

/* The rows as the register's own columns name them, so staging, comparing
   and writing all talk about the same things. */
const holderRows = people.map((p) => ({
  id: p.id, name: p.name, base_type: p.employee_type, device_status: p.device_status,
  position: p.position, department: p.department, unit: p.unit, division: p.division,
  ad_id: p.ad_id, email: p.email,
  laptops_held: Number(p.laptops_held || 0), ipads_held: Number(p.ipads_held || 0),
  devices_held: Number(p.devices_held || 0),
  laptop_serial: p.laptop_serial, laptop_model: p.laptop_model,
  ipad_serial: p.ipad_serial, ipad_model: p.ipad_model,
  remarks: p.remarks, label_source: p.label_source,
  hr_status: p.hr_status ?? '',
  base_resigned: p.resigned === 'yes' ? 1 : 0,
  last_working_day: p.last_working_day ?? '',
}));

const deviceRows = devices.map((d) => ({
  serial: d.serial, asset_type: d.asset_type ?? '', kind: d.kind, model: d.model,
  status: d.status ?? '', held: d.held === 'yes' ? 1 : 0,
  holder_id: d.holder_id || '', holder: d.holder || '',
  assigned_on: d.assigned_on ?? '', age_years: d.age_years ?? '', os: d.os ?? '',
  host_name: d.host_name ?? '', specs: d.specs ?? '', remarks: d.remarks ?? '',
}));

const write = db.transaction(() => {
  const ids = new Set(holderRows.map((p) => p.id));
  const serials = new Set(deviceRows.map((d) => d.serial));

  for (const p of holderRows) upsertHolder.run(p);
  for (const d of deviceRows) {
    upsertDevice.run({ ...d, holder_id: d.holder_id || null, holder: d.holder || null });
  }

  /* Anyone no longer in the workbook leaves the register, unless they were
     added here. The audit log keeps the history either way. */
  let goneHolders = 0;
  for (const row of db.prepare('SELECT id FROM holders WHERE created_here = 0').all()) {
    if (!ids.has(row.id)) { db.prepare('DELETE FROM holders WHERE id = ?').run(row.id); goneHolders += 1; }
  }
  let goneDevices = 0;
  for (const row of db.prepare('SELECT serial FROM devices WHERE created_here = 0').all()) {
    if (!serials.has(row.serial)) { db.prepare('DELETE FROM devices WHERE serial = ?').run(row.serial); goneDevices += 1; }
  }
  return { goneHolders, goneDevices };
});

/* Holder ids used to be the row's position in an alphabetical list, so
   adding one person to the workbook slid almost every id onto somebody
   else — and every correction in the register is filed against an id. They
   are derived from the name now. A register built before that change is
   brought forward here: where a stored record has the same name as an
   incoming one but a different id, the stored record takes the new id, and
   so does everything filed against it. */
const relabel = db.transaction(() => {
  const tidy = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const wanted = new Map(holderRows.map((row) => [tidy(row.name), row.id]));
  const taken = new Set(db.prepare('SELECT id FROM holders').all().map((row) => row.id));
  const moves = [];
  for (const row of db.prepare('SELECT id, name FROM holders').all()) {
    const next = wanted.get(tidy(row.name));
    if (!next || next === row.id) continue;
    if (taken.has(next)) continue;          /* already under the new id */
    moves.push([row.id, next, row.name]);
    taken.add(next);
  }
  for (const [from, to] of moves) {
    db.prepare('UPDATE holders SET id = ? WHERE id = ?').run(to, from);
    db.prepare('UPDATE holders SET merged_into = ? WHERE merged_into = ?').run(to, from);
    db.prepare('UPDATE devices SET holder_id = ? WHERE holder_id = ?').run(to, from);
    db.prepare('UPDATE audit SET holder_id = ? WHERE holder_id = ?').run(to, from);
    /* An assignment made in the app is an override, so it carries the id
       too. */
    for (const device of db.prepare(
      "SELECT serial, overrides FROM devices WHERE json_extract(overrides, '$.holder_id') = ?",
    ).all(from)) {
      const carried = JSON.parse(device.overrides);
      carried.holder_id = to;
      db.prepare('UPDATE devices SET overrides = ? WHERE serial = ?')
        .run(JSON.stringify(carried), device.serial);
    }
  }
  return moves;
});

const moved = relabel();
if (moved.length) {
  console.log(`${moved.length} holder ids were the row's position in a list and are now derived from `
    + 'the name, so they stop moving when the workbook changes. Every correction, fold and '
    + 'assignment filed against them moved with them.');
}

const held = devices.filter((d) => d.held === 'yes').length;
const empty = db.prepare('SELECT COUNT(*) AS n FROM holders').get().n === 0;
const takeTheLot = process.argv.includes('--apply-all');

setNote('duplicate_serials', duplicates);
if (duplicates.length) {
  console.log(`${duplicates.length} serial numbers appear more than once in the workbook and were stored once each:`);
  for (const d of duplicates) {
    console.log(`  ${d.serial}  ${d.asset_type}  ${d.statuses.join(' / ')}${d.holder ? `  ${d.holder}` : ''}`);
  }
}

if (empty || takeTheLot) {
  const { goneHolders, goneDevices } = write();
  seedLists();
  console.log(`${people.length} holders and ${devices.length} assets imported (${held} held by someone).`);
  if (goneHolders || goneDevices) {
    console.log(`Removed ${goneHolders} holders and ${goneDevices} devices no longer in the workbook.`);
  }
  const kept = db.prepare("SELECT COUNT(*) AS n FROM holders WHERE overrides IS NOT NULL").get().n;
  console.log(`${kept} corrections kept.`);
  const left = db.prepare('SELECT COUNT(*) AS n FROM holders WHERE base_resigned = 1').get().n;
  if (left) console.log(`${left} holders are on HR's resigned list.`);
} else {
  stageRows('holder', holderRows);
  stageRows('device', deviceRows);
  setNote('staged_at', new Date().toISOString());
  seedLists();
  const plan = reconcilePlan();
  const { change, clash, added, gone } = plan.totals;
  console.log(`${people.length} holders and ${devices.length} assets read from the workbook `
    + `(${held} held by someone).`);
  console.log('Nothing has been written. The register already holds data, so this workbook is '
    + 'waiting to be looked at.');
  console.log(`  ${change} field${change === 1 ? '' : 's'} the workbook would change`);
  if (clash) console.log(`  ${clash} of which would undo a correction made in the app`);
  console.log(`  ${added} row${added === 1 ? '' : 's'} the workbook has that the register does not`);
  console.log(`  ${gone} row${gone === 1 ? '' : 's'} the register has that the workbook does not`);
  console.log('Sign in as admin and open "From the workbook" to go through them, '
    + 'or re-run with --apply-all to take all of it.');
}
