import './quiet.mjs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

/* Node's own SQLite, so installing needs no C++ toolchain on the machine
   that runs this. A compiled driver has to match the exact Node version it
   is built for, which turned a two-minute setup into an afternoon. */
const file = process.env.DATABASE_PATH || './register.db';

const handle = new DatabaseSync(path.resolve(file));
handle.exec('PRAGMA journal_mode = WAL');
handle.exec('PRAGMA foreign_keys = ON');

/* node:sqlite has no transaction helper, so wrap one. Nested calls join the
   outer transaction rather than trying to start a second. */
let depth = 0;
const transaction = (fn) => (...args) => {
  if (depth > 0) return fn(...args);
  depth += 1;
  handle.exec('BEGIN');
  try {
    const out = fn(...args);
    handle.exec('COMMIT');
    return out;
  } catch (err) {
    handle.exec('ROLLBACK');
    throw err;
  } finally {
    depth -= 1;
  }
};

export const db = {
  exec: (sql) => handle.exec(sql),
  prepare: (sql) => handle.prepare(sql),
  transaction,
};

/* `base_type` is what the workbook said. `type` is what a person set here and
   is the one that counts; NULL means nobody has overridden the workbook. An
   import refreshes the base columns and never touches the overrides. */
db.exec(`
  CREATE TABLE IF NOT EXISTS holders (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    base_type     TEXT NOT NULL,
    type          TEXT,
    base_resigned INTEGER NOT NULL DEFAULT 0,
    resigned      INTEGER,
    note          TEXT,
    last_working_day TEXT,
    device_status TEXT NOT NULL,
    position      TEXT, department TEXT, unit TEXT, division TEXT,
    ad_id         TEXT, email TEXT,
    laptops_held  INTEGER NOT NULL DEFAULT 0,
    ipads_held    INTEGER NOT NULL DEFAULT 0,
    devices_held  INTEGER NOT NULL DEFAULT 0,
    laptop_serial TEXT, laptop_model TEXT,
    ipad_serial   TEXT, ipad_model TEXT,
    remarks       TEXT, label_source TEXT,
    hr_status     TEXT,
    updated_at    TEXT, updated_by TEXT
  );

  CREATE TABLE IF NOT EXISTS devices (
    serial      TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    model       TEXT NOT NULL,
    holder_id   TEXT,
    holder      TEXT,
    assigned_on TEXT, age_years TEXT, os TEXT, host_name TEXT,
    specs       TEXT, remarks TEXT
  );
  CREATE INDEX IF NOT EXISTS devices_holder ON devices(holder_id);

  CREATE TABLE IF NOT EXISTS invites (
    token      TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    created_at TEXT NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0,
    last_used  TEXT
  );

  CREATE TABLE IF NOT EXISTS audit (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL,
    actor     TEXT NOT NULL,
    holder_id TEXT NOT NULL,
    field     TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_at ON audit(at DESC);
`);

/* Databases made before HR's resigned list existed are brought forward. */
for (const [column, definition] of [
  ['base_resigned', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_working_day', 'TEXT'],
  ['hr_status', 'TEXT'],
  ['overrides', 'TEXT'],
]) {
  const present = handle.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?')
    .get('holders', column);
  if (!present) handle.exec(`ALTER TABLE holders ADD COLUMN ${column} ${definition}`);
}

/* Corrections made in the app live together in one JSON column, so adding
   another editable column later needs no migration. Earlier versions kept
   type, resigned and note in columns of their own; those fold in once. */
const EDITABLE = new Map([
  ['name', 'Holder'], ['type', 'Type'], ['resigned', 'Resigned'],
  ['position', 'Position'], ['department', 'Department'], ['unit', 'Unit'],
  ['lap', 'Laptop serial'], ['lapM', 'Laptop model'],
  ['ipd', 'iPad serial'], ['ipdM', 'iPad model'],
  ['rem', 'Inventory remark'], ['note', 'Note'],
]);
export const editableFields = [...EDITABLE.entries()].map(([key, label]) => ({ key, label }));

{
  const stale = handle.prepare(
    `SELECT id, type, resigned, note FROM holders
      WHERE overrides IS NULL AND (type IS NOT NULL OR resigned IS NOT NULL OR note IS NOT NULL)`,
  ).all();
  const write = handle.prepare('UPDATE holders SET overrides = ? WHERE id = ?');
  for (const row of stale) {
    const carried = {};
    if (row.type !== null) carried.type = row.type;
    if (row.resigned !== null) carried.resigned = Boolean(row.resigned);
    if (row.note !== null) carried.note = row.note;
    write.run(JSON.stringify(carried), row.id);
  }
}

/* What the workbook and HR say, before any correction is laid over it. */
const SELECT = `
  SELECT id, name, base_type AS type, base_resigned AS resigned,
         last_working_day AS lwd, hr_status,
         position, department, unit, division, ad_id, email,
         laptop_serial AS lap, laptop_model AS lapM,
         ipad_serial AS ipd, ipad_model AS ipdM,
         remarks AS rem, '' AS note, label_source AS src,
         overrides, updated_at, updated_by
    FROM holders`;

const allHolders = db.prepare(`${SELECT} ORDER BY name COLLATE NOCASE`);
const oneHolder = db.prepare(`${SELECT} WHERE id = ?`);
const fleetRows = db.prepare(
  `SELECT model, kind, COUNT(*) AS n FROM devices GROUP BY model, kind ORDER BY n DESC`,
);

const serials = (value) => String(value || '').split(';').map((x) => x.trim()).filter(Boolean);

/* Counts and the device label follow from the serials, so correcting a serial
   moves them with it rather than leaving the row contradicting itself. */
const derive = (row) => {
  const nL = serials(row.lap).length;
  const nI = serials(row.ipd).length;
  return {
    ...row, nL, nI, n: nL + nI,
    status: nL && nI ? 'Both' : nL ? 'Laptop only' : nI ? 'iPad only' : 'No device',
  };
};

const readOverrides = (text) => {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
};

/* The base row with every correction laid over it. `base` keeps what the
   workbook said, so the page can offer it back. */
const toRow = (row) => {
  const { overrides, ...rest } = { ...row };
  const base = { ...rest, resigned: Boolean(rest.resigned) };
  const carried = readOverrides(overrides);
  const changed = Object.keys(carried).filter((key) => EDITABLE.has(key));
  const merged = { ...base };
  for (const key of changed) {
    merged[key] = key === 'resigned' ? Boolean(carried[key]) : carried[key];
  }
  return derive({ ...merged, base: derive(base), changed });
};

export const listHolders = () => allHolders.all().map(toRow);
export const getHolder = (id) => {
  const row = oneHolder.get(id);
  return row ? toRow(row) : null;
};
export const listFleet = () => fleetRows.all();
export const listDevices = (id) =>
  db.prepare('SELECT * FROM devices WHERE holder_id = ? ORDER BY kind, serial').all(id);

const writeAudit = db.prepare(
  `INSERT INTO audit (at, actor, holder_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`,
);

/* Applies only the fields that actually changed, and records each one. */
export const updateHolder = db.transaction((id, patch, actor) => {
  const before = getHolder(id);
  if (!before) return null;

  const carried = { ...readOverrides(
    db.prepare('SELECT overrides FROM holders WHERE id = ?').get(id).overrides,
  ) };
  const at = new Date().toISOString();
  const changes = [];

  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE.has(key)) continue;
    const next = key === 'resigned' ? (value === null ? null : Boolean(value)) : value;
    const was = before[key];
    /* null means "put the workbook's value back", and a value equal to the
       workbook's is the same thing said another way. */
    const sameAsBase = next !== null && (key === 'resigned'
      ? Boolean(next) === Boolean(before.base.resigned)
      : String(next ?? '') === String(before.base[key] ?? ''));

    if (next === null || sameAsBase) {
      if (!(key in carried)) continue;
      delete carried[key];
      changes.push([key, String(was ?? ''), String(before.base[key] ?? '')]);
      continue;
    }
    if (String(next) === String(was ?? '')) continue;
    carried[key] = next;
    changes.push([key, String(was ?? ''), String(next)]);
  }

  if (!changes.length) return before;

  db.prepare('UPDATE holders SET overrides = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(Object.keys(carried).length ? JSON.stringify(carried) : null, at, actor, id);
  for (const [field, oldValue, newValue] of changes) {
    writeAudit.run(at, actor, id, field, oldValue, newValue);
  }
  return getHolder(id);
});

export const listAudit = (limit = 200) =>
  db.prepare(
    `SELECT a.*, h.name FROM audit a LEFT JOIN holders h ON h.id = a.holder_id
      ORDER BY a.id DESC LIMIT ?`,
  ).all(limit);
