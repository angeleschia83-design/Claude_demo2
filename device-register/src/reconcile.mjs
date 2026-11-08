/* A new workbook, read against the register rather than over it.
 *
 * The import used to write straight into the register. That is fine the
 * first time and wrong every time after: a spreadsheet nobody had checked
 * could undo a correction made here, silently, and the two would differ
 * without anyone knowing which was right.
 *
 * An import now puts the workbook's rows to one side. This works out what
 * taking them would change, marks the ones that would overwrite a
 * correction made here, and applies only what is picked.
 */
import { db, readOverrides, recordChange } from './db.mjs';

const text = (value) => (value === null || value === undefined ? '' : String(value).trim());

/* The columns the workbook owns, and what to call them on screen. Anything
   not named here the workbook does not get a say in. */
export const HOLDER_FIELDS = new Map([
  ['name', 'Name'], ['base_type', 'Type (workbook)'], ['position', 'Position'],
  ['department', 'Department'], ['unit', 'Unit'], ['division', 'Division'],
  ['ad_id', 'Network ID'], ['email', 'Email'],
  ['laptop_serial', 'Laptop serial'], ['laptop_model', 'Laptop model'],
  ['ipad_serial', 'iPad serial'], ['ipad_model', 'iPad model'],
  ['remarks', 'Remark'], ['hr_status', 'On the HR list'],
  ['base_resigned', 'Resigned (HR)'], ['last_working_day', 'Last working day'],
  ['device_status', 'Device'], ['label_source', 'Type source'],
]);

export const DEVICE_FIELDS = new Map([
  ['asset_type', 'Asset type'], ['kind', 'Kind'], ['model', 'Model'],
  ['status', 'Status'], ['holder_id', 'Held by (id)'], ['holder', 'Held by'],
  ['assigned_on', 'Assigned on'], ['age_years', 'Age in years'],
  ['os', 'Operating system'], ['host_name', 'Host name'],
  ['specs', 'Specification'], ['remarks', 'Remark'],
]);

/* A correction here covers the field it names; these two are the holder
   columns an asset-side correction writes, under different names. */
const OVERRIDE_OF = new Map([
  ['base_type', 'type'], ['base_resigned', 'resigned'], ['name', 'name'],
  ['position', 'position'], ['department', 'department'], ['unit', 'unit'],
  ['laptop_serial', 'lap'], ['laptop_model', 'lapM'],
  ['ipad_serial', 'ipd'], ['ipad_model', 'ipdM'], ['remarks', 'rem'],
]);

/* ---------- putting a workbook to one side ---------- */

/* A person is known by their id and an asset by its serial; staging keeps
   whichever the row carries, because staging the wrong one would quietly
   fold a whole workbook into a single row. */
const idOfRow = (row) => String(row.id ?? row.serial ?? '');

export const stageRows = db.transaction((kind, rows) => {
  db.prepare('DELETE FROM stage WHERE kind = ?').run(kind);
  const put = db.prepare('INSERT OR REPLACE INTO stage (kind, id, body) VALUES (?, ?, ?)');
  let n = 0;
  for (const row of rows) {
    const id = idOfRow(row);
    if (!id) continue;
    put.run(kind, id, JSON.stringify(row));
    n += 1;
  }
  if (n !== rows.length) {
    throw new Error(`${rows.length - n} ${kind} rows have no id or serial and were not staged.`);
  }
  return n;
});

export const clearStage = db.transaction(() => {
  db.prepare('DELETE FROM stage').run();
});

const staged = (kind) => db.prepare('SELECT id, body FROM stage WHERE kind = ?').all(kind)
  .map((row) => ({ ...JSON.parse(row.body), id: row.id }));

export const hasStage = () => db.prepare('SELECT COUNT(*) AS n FROM stage').get().n > 0;

/* ---------- what taking it would change ---------- */

const compare = ({ kind, fields, live, incoming, idOf, labelOf, overrideOf }) => {
  const here = new Map(live.map((row) => [String(idOf(row)), row]));
  const changes = [];
  const added = [];
  const gone = [];

  for (const row of incoming) {
    const id = String(idOf(row));
    const mine = here.get(id);
    if (!mine) {
      added.push({ kind, id, label: labelOf(row), summary: summarise(kind, row) });
      continue;
    }
    const carried = readOverrides(mine.overrides);
    for (const [field, label] of fields) {
      const was = text(mine[field]);
      const now = text(row[field]);
      if (was === now) continue;
      /* Somebody here corrected this very field. Taking the workbook's
         value means dropping their correction, so it is never ticked for
         them. */
      const key = overrideOf(field);
      const corrected = key && key in carried;
      changes.push({
        kind, id, field, label,
        name: labelOf(mine), was, now,
        /* What the page is showing today, which is the correction when
           there is one and the workbook's old value when there is not. */
        showing: corrected ? text(carried[key]) : was,
        state: corrected ? 'clash' : 'change',
        key: `${kind}:${id}:${field}`,
      });
    }
  }

  for (const row of live) {
    const id = String(idOf(row));
    if (incoming.some((other) => String(idOf(other)) === id)) continue;
    /* Something added here is not something the workbook has forgotten. */
    if (row.created_here) continue;
    gone.push({ kind, id, label: labelOf(row), summary: summarise(kind, row) });
  }

  return { changes, added, gone };
};

const summarise = (kind, row) => (kind === 'device'
  ? [row.asset_type || row.kind, row.model, row.status, row.holder].filter(Boolean).join(' · ')
  : [row.position || row.base_type, row.department].filter(Boolean).join(' · '));

export const reconcilePlan = () => {
  if (!hasStage()) return null;

  const liveHolders = db.prepare('SELECT * FROM holders').all();
  const liveDevices = db.prepare('SELECT * FROM devices').all();

  const holders = compare({
    kind: 'holder',
    fields: HOLDER_FIELDS,
    live: liveHolders,
    incoming: staged('holder'),
    idOf: (row) => row.id,
    labelOf: (row) => row.name,
    overrideOf: (field) => OVERRIDE_OF.get(field),
  });
  const devices = compare({
    kind: 'device',
    fields: DEVICE_FIELDS,
    live: liveDevices,
    incoming: staged('device'),
    idOf: (row) => row.serial ?? row.id,
    labelOf: (row) => row.serial ?? row.id,
    /* An asset's corrections are stored under the same names, so the field
       is its own key — except the two the assign path writes. */
    overrideOf: (field) => field,
  });

  const count = (part, state) => part.changes.filter((row) => row.state === state).length;
  return {
    at: db.prepare("SELECT value FROM notes WHERE key = 'staged_at'").get()?.value?.replace(/"/g, '') || '',
    holders,
    devices,
    totals: {
      change: count(holders, 'change') + count(devices, 'change'),
      clash: count(holders, 'clash') + count(devices, 'clash'),
      added: holders.added.length + devices.added.length,
      gone: holders.gone.length + devices.gone.length,
    },
  };
};

/* ---------- taking the parts that were picked ---------- */

const insertHolder = (row) => db.prepare(`
  INSERT INTO holders (id, name, base_type, device_status, position, department, unit, division,
                       ad_id, email, laptops_held, ipads_held, devices_held,
                       laptop_serial, laptop_model, ipad_serial, ipad_model, remarks, label_source,
                       hr_status, base_resigned, last_working_day)
  VALUES (@id, @name, @base_type, @device_status, @position, @department, @unit, @division,
          @ad_id, @email, @laptops_held, @ipads_held, @devices_held,
          @laptop_serial, @laptop_model, @ipad_serial, @ipad_model, @remarks, @label_source,
          @hr_status, @base_resigned, @last_working_day)
`).run({
  id: row.id, name: row.name ?? '', base_type: row.base_type ?? 'Unknown',
  device_status: row.device_status ?? 'No device',
  position: row.position ?? '', department: row.department ?? '', unit: row.unit ?? '',
  division: row.division ?? '', ad_id: row.ad_id ?? '', email: row.email ?? '',
  laptops_held: Number(row.laptops_held || 0), ipads_held: Number(row.ipads_held || 0),
  devices_held: Number(row.devices_held || 0),
  laptop_serial: row.laptop_serial ?? '', laptop_model: row.laptop_model ?? '',
  ipad_serial: row.ipad_serial ?? '', ipad_model: row.ipad_model ?? '',
  remarks: row.remarks ?? '', label_source: row.label_source ?? '',
  hr_status: row.hr_status ?? '', base_resigned: Number(row.base_resigned || 0),
  last_working_day: row.last_working_day ?? '',
});

const insertDevice = (row) => db.prepare(`
  INSERT INTO devices (serial, asset_type, kind, model, status, held, holder_id, holder,
                       assigned_on, age_years, os, host_name, specs, remarks)
  VALUES (@serial, @asset_type, @kind, @model, @status, @held, @holder_id, @holder,
          @assigned_on, @age_years, @os, @host_name, @specs, @remarks)
`).run({
  serial: row.serial ?? row.id, asset_type: row.asset_type ?? '', kind: row.kind ?? 'Other',
  model: row.model ?? '', status: row.status ?? '', held: row.holder_id ? 1 : 0,
  holder_id: row.holder_id || null, holder: row.holder || null,
  assigned_on: row.assigned_on ?? '', age_years: row.age_years ?? '', os: row.os ?? '',
  host_name: row.host_name ?? '', specs: row.specs ?? '', remarks: row.remarks ?? '',
});

export const applyPlan = db.transaction((picked, actor) => {
  const plan = reconcilePlan();
  if (!plan) return { error: 'There is no workbook waiting.' };
  const wanted = new Set(picked || []);
  const at = new Date().toISOString();
  const out = { fields: 0, added: 0, gone: 0 };

  const stagedHolders = new Map(staged('holder').map((row) => [String(row.id), row]));
  const stagedDevices = new Map(staged('device').map((row) => [String(row.serial ?? row.id), row]));

  for (const change of [...plan.holders.changes, ...plan.devices.changes]) {
    if (!wanted.has(change.key)) continue;
    if (change.kind === 'holder') {
      db.prepare(`UPDATE holders SET ${change.field} = ? WHERE id = ?`).run(change.now, change.id);
      /* Taking the workbook's value where a correction disagreed means
         letting the correction go, or the page would still show the old
         one. */
      if (change.state === 'clash') {
        const row = db.prepare('SELECT overrides FROM holders WHERE id = ?').get(change.id);
        const carried = readOverrides(row.overrides);
        delete carried[OVERRIDE_OF.get(change.field)];
        db.prepare('UPDATE holders SET overrides = ? WHERE id = ?')
          .run(Object.keys(carried).length ? JSON.stringify(carried) : null, change.id);
      }
      recordChange({ at, actor, holderId: change.id, field: change.label,
        was: change.showing, now: change.now });
    } else {
      db.prepare(`UPDATE devices SET ${change.field} = ? WHERE serial = ?`).run(change.now, change.id);
      if (change.field === 'holder_id') {
        db.prepare('UPDATE devices SET held = ? WHERE serial = ?').run(change.now ? 1 : 0, change.id);
      }
      if (change.state === 'clash') {
        const row = db.prepare('SELECT overrides FROM devices WHERE serial = ?').get(change.id);
        const carried = readOverrides(row.overrides);
        delete carried[change.field];
        db.prepare('UPDATE devices SET overrides = ? WHERE serial = ?')
          .run(Object.keys(carried).length ? JSON.stringify(carried) : null, change.id);
      }
      recordChange({ at, actor, serial: change.id, field: change.label,
        was: change.showing, now: change.now });
    }
    out.fields += 1;
  }

  for (const row of [...plan.holders.added, ...plan.devices.added]) {
    if (!wanted.has(`add:${row.kind}:${row.id}`)) continue;
    if (row.kind === 'holder') insertHolder(stagedHolders.get(row.id));
    else insertDevice(stagedDevices.get(row.id));
    recordChange({ at, actor, holderId: row.kind === 'holder' ? row.id : '',
      serial: row.kind === 'device' ? row.id : null,
      field: 'added by the workbook', was: '', now: row.label });
    out.added += 1;
  }

  for (const row of [...plan.holders.gone, ...plan.devices.gone]) {
    if (!wanted.has(`gone:${row.kind}:${row.id}`)) continue;
    if (row.kind === 'holder') db.prepare('DELETE FROM holders WHERE id = ?').run(row.id);
    else db.prepare('DELETE FROM devices WHERE serial = ?').run(row.id);
    recordChange({ at, actor, holderId: row.kind === 'holder' ? row.id : '',
      serial: row.kind === 'device' ? row.id : null,
      field: 'no longer in the workbook', was: row.label, now: '(removed)' });
    out.gone += 1;
  }

  return out;
});
