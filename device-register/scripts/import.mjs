/* Loads data/people.csv and data/devices.csv into SQLite.
   Safe to re-run: it refreshes what the workbook owns and leaves every
   correction made in the app (type, resigned, note) untouched. */
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

const { db } = await import('../src/db.mjs');

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

const upsertHolder = db.prepare(`
  INSERT INTO holders (id, name, base_type, device_status, position, department, unit, division,
                       ad_id, email, laptops_held, ipads_held, devices_held,
                       laptop_serial, laptop_model, ipad_serial, ipad_model, remarks, label_source,
                       hr_status)
  VALUES (@id, @name, @base_type, @device_status, @position, @department, @unit, @division,
          @ad_id, @email, @laptops_held, @ipads_held, @devices_held,
          @laptop_serial, @laptop_model, @ipad_serial, @ipad_model, @remarks, @label_source,
          @hr_status)
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
    hr_status = excluded.hr_status
`);

const upsertDevice = db.prepare(`
  INSERT INTO devices (serial, kind, model, holder_id, holder, assigned_on, age_years, os, host_name, specs, remarks)
  VALUES (@serial, @kind, @model, @holder_id, @holder, @assigned_on, @age_years, @os, @host_name, @specs, @remarks)
  ON CONFLICT(serial) DO UPDATE SET
    kind = excluded.kind, model = excluded.model, holder_id = excluded.holder_id,
    holder = excluded.holder, assigned_on = excluded.assigned_on, age_years = excluded.age_years,
    os = excluded.os, host_name = excluded.host_name, specs = excluded.specs, remarks = excluded.remarks
`);

const run = db.transaction(() => {
  const ids = new Set(people.map((p) => p.id));
  const serials = new Set(devices.map((d) => d.serial));

  for (const p of people) {
    upsertHolder.run({
      id: p.id, name: p.name, base_type: p.employee_type, device_status: p.device_status,
      position: p.position, department: p.department, unit: p.unit, division: p.division,
      ad_id: p.ad_id, email: p.email,
      laptops_held: Number(p.laptops_held || 0), ipads_held: Number(p.ipads_held || 0),
      devices_held: Number(p.devices_held || 0),
      laptop_serial: p.laptop_serial, laptop_model: p.laptop_model,
      ipad_serial: p.ipad_serial, ipad_model: p.ipad_model,
      remarks: p.remarks, label_source: p.label_source,
      hr_status: p.hr_status ?? '',
    });
  }
  for (const d of devices) {
    upsertDevice.run({
      serial: d.serial, kind: d.kind, model: d.model, holder_id: d.holder_id, holder: d.holder,
      assigned_on: d.assigned_on, age_years: d.age_years, os: d.os ?? '',
      host_name: d.host_name ?? '', specs: d.specs ?? '', remarks: d.remarks ?? '',
    });
  }

  /* Anyone no longer holding a device leaves the register; their corrections
     go with them, which is why the audit log keeps the history. */
  let goneHolders = 0;
  for (const row of db.prepare('SELECT id FROM holders').all()) {
    if (!ids.has(row.id)) { db.prepare('DELETE FROM holders WHERE id = ?').run(row.id); goneHolders += 1; }
  }
  let goneDevices = 0;
  for (const row of db.prepare('SELECT serial FROM devices').all()) {
    if (!serials.has(row.serial)) { db.prepare('DELETE FROM devices WHERE serial = ?').run(row.serial); goneDevices += 1; }
  }
  return { goneHolders, goneDevices };
});

const { goneHolders, goneDevices } = run();
const kept = db.prepare('SELECT COUNT(*) AS n FROM holders WHERE type IS NOT NULL OR resigned = 1 OR note IS NOT NULL').get().n;

console.log(`${people.length} holders and ${devices.length} devices imported.`);
if (goneHolders || goneDevices) console.log(`Removed ${goneHolders} holders and ${goneDevices} devices no longer in the workbook.`);
console.log(`${kept} corrections kept.`);
