import Database from 'better-sqlite3';
import path from 'node:path';

const file = process.env.DATABASE_PATH || './register.db';

export const db = new Database(path.resolve(file));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* `base_type` is what the workbook said. `type` is what a person set here and
   is the one that counts; NULL means nobody has overridden the workbook. An
   import refreshes the base columns and never touches the overrides. */
db.exec(`
  CREATE TABLE IF NOT EXISTS holders (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    base_type     TEXT NOT NULL,
    type          TEXT,
    resigned      INTEGER NOT NULL DEFAULT 0,
    note          TEXT,
    device_status TEXT NOT NULL,
    position      TEXT, department TEXT, unit TEXT, division TEXT,
    ad_id         TEXT, email TEXT,
    laptops_held  INTEGER NOT NULL DEFAULT 0,
    ipads_held    INTEGER NOT NULL DEFAULT 0,
    devices_held  INTEGER NOT NULL DEFAULT 0,
    laptop_serial TEXT, laptop_model TEXT,
    ipad_serial   TEXT, ipad_model TEXT,
    remarks       TEXT, label_source TEXT,
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

/* The effective type: the override when one is set, else the workbook's. */
const SELECT = `
  SELECT id, name,
         COALESCE(type, base_type) AS type,
         base_type, (type IS NOT NULL) AS overridden,
         resigned, note, device_status AS status,
         position, department, unit, division, ad_id, email,
         laptops_held AS nL, ipads_held AS nI, devices_held AS n,
         laptop_serial AS lap, laptop_model AS lapM,
         ipad_serial AS ipd, ipad_model AS ipdM,
         remarks AS rem, label_source AS src,
         updated_at, updated_by
    FROM holders`;

const allHolders = db.prepare(`${SELECT} ORDER BY name COLLATE NOCASE`);
const oneHolder = db.prepare(`${SELECT} WHERE id = ?`);
const fleetRows = db.prepare(
  `SELECT model, kind, COUNT(*) AS n FROM devices GROUP BY model, kind ORDER BY n DESC`,
);

const toRow = (row) => ({
  ...row,
  resigned: Boolean(row.resigned),
  overridden: Boolean(row.overridden),
});

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
  const at = new Date().toISOString();
  const changes = [];

  if (patch.type !== undefined && patch.type !== before.type) {
    db.prepare('UPDATE holders SET type = ? WHERE id = ?')
      .run(patch.type === before.base_type ? null : patch.type, id);
    changes.push(['type', before.type, patch.type]);
  }
  if (patch.resigned !== undefined && Boolean(patch.resigned) !== before.resigned) {
    db.prepare('UPDATE holders SET resigned = ? WHERE id = ?').run(patch.resigned ? 1 : 0, id);
    changes.push(['resigned', String(before.resigned), String(Boolean(patch.resigned))]);
  }
  if (patch.note !== undefined && (patch.note || '') !== (before.note || '')) {
    db.prepare('UPDATE holders SET note = ? WHERE id = ?').run(patch.note || null, id);
    changes.push(['note', before.note, patch.note]);
  }

  if (!changes.length) return before;
  db.prepare('UPDATE holders SET updated_at = ?, updated_by = ? WHERE id = ?').run(at, actor, id);
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
