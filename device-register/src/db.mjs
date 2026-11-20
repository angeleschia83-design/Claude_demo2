import './quiet.mjs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { findDuplicates } from './duplicates.mjs';

/* Node's own SQLite, so installing needs no C++ toolchain on the machine
   that runs this. A compiled driver has to match the exact Node version it
   is built for, which turned a two-minute setup into an afternoon. */
const file = process.env.DATABASE_PATH || './register.db';
/** The database's full path; backups go beside it. */
export const dbFile = path.resolve(file);

const handle = new DatabaseSync(dbFile);
handle.exec('PRAGMA journal_mode = WAL');
handle.exec('PRAGMA foreign_keys = ON');
/* WAL serialises writers rather than removing the lock, and `npm run import`
   is a second process against this same file. Without a busy timeout the
   server's next write fails the instant the importer holds the lock. */
handle.exec('PRAGMA busy_timeout = 5000');

/* node:sqlite has no transaction helper, so wrap one. Nested calls join the
   outer transaction rather than trying to start a second. */
let depth = 0;
const transaction = (fn) => (...args) => {
  if (depth > 0) return fn(...args);
  depth += 1;
  try {
    handle.exec('BEGIN');
  } catch (err) {
    /* BEGIN failing must not leave `depth` above zero. It used to sit outside
       the try below, so a single SQLITE_BUSY stranded the counter and every
       later call took the nested branch — running with no transaction at all,
       for the life of the process, silently. */
    depth -= 1;
    throw err;
  }
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
    asset_type  TEXT,
    kind        TEXT NOT NULL,
    model       TEXT NOT NULL,
    status      TEXT,
    held        INTEGER NOT NULL DEFAULT 0,
    holder_id   TEXT,
    holder      TEXT,
    assigned_on TEXT, age_years TEXT, os TEXT, host_name TEXT,
    specs       TEXT, remarks TEXT,
    /* Optional, and never carried by the workbook: a person types these
       in when the asset is added, so no import overwrites them. */
    invoice_date TEXT, purchased_on TEXT
  );
  CREATE INDEX IF NOT EXISTS devices_holder ON devices(holder_id);

  CREATE TABLE IF NOT EXISTS notes (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  /* What a new workbook says, held to one side until somebody has looked
     at it. An import used to overwrite the register with it, which is how a
     correction made here could be undone by a spreadsheet nobody had
     checked. */
  CREATE TABLE IF NOT EXISTS stage (
    kind TEXT NOT NULL,
    id   TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  );

  CREATE TABLE IF NOT EXISTS invites (
    token      TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    created_at TEXT NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0,
    last_used  TEXT
  );

  /* The words a person may pick for a status, an asset type or a model.
     Seeded from whatever the workbook already uses, so nothing is named in
     advance; adding one is a deliberate act and is recorded. */
  CREATE TABLE IF NOT EXISTS lists (
    kind     TEXT NOT NULL,
    value    TEXT NOT NULL,
    added_at   TEXT, added_by TEXT,
    assignable INTEGER NOT NULL DEFAULT 1,
    retired    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, value)
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

/* Databases made before the asset side existed are brought forward. */
let addedHeld = false;
for (const [column, definition] of [
  ['asset_type', 'TEXT'],
  ['status', 'TEXT'],
  ['held', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  const present = handle.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?')
    .get('devices', column);
  if (!present) {
    handle.exec(`ALTER TABLE devices ADD COLUMN ${column} ${definition}`);
    if (column === 'held') addedHeld = true;
  }
}
/* A column added to a table that already has rows defaults every one of them
   to 0, so an upgraded register showed an empty fleet chart until somebody
   ran a full import. Derive it once from the holder the workbook recorded. */
if (addedHeld) {
  handle.exec("UPDATE devices SET held = 1 WHERE holder_id IS NOT NULL AND holder_id <> ''");
}

for (const [column, definition] of [
  ['serial', 'TEXT'],
  ['ticket', 'TEXT'],
]) {
  const present = handle.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?')
    .get('audit', column);
  if (!present) handle.exec(`ALTER TABLE audit ADD COLUMN ${column} ${definition}`);
}

for (const [column, definition] of [
  ['overrides', 'TEXT'],
  /* Both optional, both typed in here rather than read from the workbook. */
  ['invoice_date', 'TEXT'],
  ['purchased_on', 'TEXT'],
  ['created_here', 'INTEGER NOT NULL DEFAULT 0'],
  ['created_at', 'TEXT'],
  ['created_by', 'TEXT'],
  /* An asset taken off the register. Kept rather than deleted, for the same
     reason a folded holder is: the workbook goes on listing it, so a row
     deleted here would come back at the next import. */
  ['removed_at', 'TEXT'],
  ['removed_by', 'TEXT'],
  ['removed_reason', 'TEXT'],
]) {
  const present = handle.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?')
    .get('devices', column);
  if (!present) handle.exec(`ALTER TABLE devices ADD COLUMN ${column} ${definition}`);
}

for (const [column, definition] of [
  ['base_resigned', 'INTEGER NOT NULL DEFAULT 0'],
  ['created_here', 'INTEGER NOT NULL DEFAULT 0'],
  ['created_at', 'TEXT'],
  ['created_by', 'TEXT'],
  ['last_working_day', 'TEXT'],
  ['hr_status', 'TEXT'],
  ['overrides', 'TEXT'],
  /* One person entered twice is folded into one record. The other stays in
     the table rather than being deleted: the workbook goes on producing
     both rows, so a deleted one would come back at the next import. */
  ['merged_into', 'TEXT'],
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
  /* Clearing the legacy columns is what makes this a one-off. Leaving them set
     meant the block matched again on the next start, so a correction somebody
     deliberately reverted (which writes overrides = NULL) came back. */
  const write = handle.prepare(
    'UPDATE holders SET overrides = ?, type = NULL, resigned = NULL, note = NULL WHERE id = ?',
  );
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
         overrides, updated_at, updated_by, created_here, merged_into
    FROM holders`;

/* A record folded into another is not a holder any more; it stays in the
   table so an import cannot resurrect it, and so it can be put back. */
const allHolders = db.prepare(`${SELECT} WHERE merged_into IS NULL ORDER BY name COLLATE NOCASE`);
const oneHolder = db.prepare(`${SELECT} WHERE id = ?`);
/* The fleet chart is about hardware in people's hands, so it counts only the
   held rows. The asset summary below counts everything. */
/* An assignment made here is an override, so the `held` column on its own
   answers with whatever the last import said and ignores every hand-out and
   return since. Where the app has set a holder, that wins; otherwise fall
   back to the column. */
const HELD_NOW = `CASE WHEN json_extract(overrides, '$.holder_id') IS NOT NULL
                         THEN json_extract(overrides, '$.holder_id') <> ''
                       ELSE held = 1 END`;

const fleetRows = db.prepare(
  `SELECT CASE WHEN model = '' THEN 'Model not recorded' ELSE model END AS model,
          kind, COUNT(*) AS n
     FROM devices WHERE ${HELD_NOW} AND removed_at IS NULL
    GROUP BY model, kind ORDER BY n DESC`,
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
  return derive({ ...merged, base: derive(base), changed, createdHere: Boolean(row.created_here) });
};

export const listHolders = () => allHolders.all().map(toRow);
export const getHolder = (id) => {
  const row = oneHolder.get(id);
  return row ? toRow(row) : null;
};
export const listFleet = () => fleetRows.all();
/* Resolved through the override for the same reason as the fleet count: the
   raw column answers with the workbook's assignment, not the register's. */
export const listDevices = (id) =>
  db.prepare(
    `SELECT * FROM devices
      WHERE COALESCE(json_extract(overrides, '$.holder_id'), holder_id, '') = ?
        AND removed_at IS NULL
      ORDER BY kind, serial`,
  ).all(id);

const auditRow = db.prepare(
  `INSERT INTO audit (at, actor, holder_id, serial, field, old_value, new_value, ticket)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
/* The asset side writes here too, so one log holds everything: a holder's
   id or an asset's serial, whichever the change was about. */
export const recordChange = ({ at, actor, holderId = '', serial = null, field, was, now, ticket = null }) =>
  auditRow.run(at, actor, holderId, serial, field, was ?? '', now ?? '', ticket);

export { readOverrides };

/* Applies only the fields that actually changed, and records each one. */
export const updateHolder = db.transaction((id, patch, actor, ticket = null) => {
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
    recordChange({ at, actor, holderId: id, field, was: oldValue, now: newValue, ticket });
  }
  return getHolder(id);
});

/* Counted from the rows themselves, so an asset type, status or model nobody
   has seen before appears on its own. This is what the spreadsheet could not
   do: its COUNTIFS named every model in the formula, and quietly dropped
   anything that was not on the list. */
/* Every one of these columns is correctable here, and a correction is an
   override. Reading the raw column left a corrected status, model or age out
   of the counts, the dashboard pivots and the exported sheets. */
const effective = (column) => `COALESCE(json_extract(overrides, '$.${column}'), ${column})`;
const blank = (column, label) =>
  `CASE WHEN ${effective(column)} IS NULL OR ${effective(column)} = '' THEN '${label}'
        ELSE ${effective(column)} END`;

const summaryRows = db.prepare(`
  SELECT ${blank('asset_type', 'No asset type')} AS type,
         ${blank('status', 'No status recorded')} AS status,
         ${blank('model', 'No model recorded')} AS model,
         CASE WHEN ${effective('age_years')} IS NULL OR ${effective('age_years')} = ''
                THEN 'No age recorded'
              WHEN CAST(${effective('age_years')} AS REAL) <= 2 THEN '2 years or less'
              ELSE 'Over 2 years' END AS age,
         COUNT(*) AS n
    FROM devices
   WHERE removed_at IS NULL
   GROUP BY type, status, model, age`);

export const setNote = (key, value) =>
  db.prepare('INSERT INTO notes (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));

export const getNote = (key) => {
  const row = db.prepare('SELECT value FROM notes WHERE key = ?').get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch (err) {
    return null;
  }
};

export const listSummary = () => ({
  rows: summaryRows.all().map((row) => ({ ...row })),
  total: db.prepare('SELECT COUNT(*) AS n FROM devices WHERE removed_at IS NULL').get().n,
  /* A serial is one piece of hardware, so a serial listed twice is stored
     once. Saying how many were collapsed keeps that honest. */
  duplicates: getNote('duplicate_serials') || [],
});

/* The change log is never deleted from. A person deleted from the register
   keeps their name on every line about them: it is read back from the line
   that recorded the deletion. `from` and `to` are ISO times, either end
   optional. */
const auditWhere = ({ from, to } = {}) => {
  const terms = [];
  const args = [];
  if (from) { terms.push('a.at >= ?'); args.push(from); }
  if (to) { terms.push('a.at < ?'); args.push(to); }
  return { where: terms.length ? `WHERE ${terms.join(' AND ')}` : '', args };
};

export const listAudit = (limit = 200, range = {}) => {
  const { where, args } = auditWhere(range);
  return db.prepare(
    `SELECT a.*, COALESCE(h.name, (SELECT d.old_value FROM audit d
              WHERE d.holder_id = a.holder_id AND d.field = 'removed from the register'
              ORDER BY d.id DESC LIMIT 1)) AS name
       FROM audit a LEFT JOIN holders h ON h.id = a.holder_id
      ${where} ORDER BY a.id DESC LIMIT ?`,
  ).all(...args, limit).map((row) => ({ ...row }));
};

export const lastAuditId = () => db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM audit').get().n;

export const countAudit = (range = {}) => {
  const { where, args } = auditWhere(range);
  return db.prepare(`SELECT COUNT(*) AS n FROM audit a ${where}`).get(...args).n;
};

/* Everything in the inventory that cannot be taken at face value, counted
   from the rows rather than from a list somebody has to remember to update. */
export const listProblems = () => {
  const rows = (sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }));
  /* Pairs that look like one person twice, with whatever a person has
     already said is not a duplicate left out. */
  const settled = new Set(getNote('not_duplicates') || []);
  const duplicatePeople = findDuplicates(listHolders()).filter((pair) => !settled.has(pair.key));
  return {
    duplicatePeople,
    duplicates: getNote('duplicate_serials') || [],
    noStatus: rows(
      `SELECT serial, asset_type, model, holder FROM devices
        WHERE removed_at IS NULL AND (status IS NULL OR status = '')
        ORDER BY asset_type, serial`),
    noModel: rows(
      `SELECT serial, asset_type, status, holder FROM devices
        WHERE removed_at IS NULL AND (model IS NULL OR model = '')
          AND asset_type IN ('Laptop', 'Imac', 'iPad') ORDER BY serial`),
    oddStatus: rows(
      `SELECT status, COUNT(*) AS n FROM devices
        WHERE removed_at IS NULL AND status IS NOT NULL AND status <> ''
        GROUP BY status HAVING n <= 2 ORDER BY n`),
    /* Marked as out with somebody, with nobody named. The workbook has 228
       of these: accessories and monitors assigned to a floor or a room
       rather than a person, which is fine until somebody has to find one. */
    assignedToNobody: rows(
      /* The status as corrected, not as the workbook had it: a piece taken
         back and set to Available read as still assigned to nobody. */
      `SELECT serial, asset_type, model, COALESCE(json_extract(overrides, '$.status'), status) AS status FROM devices
        WHERE removed_at IS NULL AND COALESCE(json_extract(overrides, '$.status'), status) LIKE '%ssigned%'
          AND COALESCE(json_extract(overrides, '$.holder_id'), holder_id, '') = ''
        ORDER BY asset_type, serial`),
    noAge: db.prepare(
      `SELECT COUNT(*) AS n FROM devices
        WHERE removed_at IS NULL AND (age_years IS NULL OR age_years = '')`).get().n,
    /* Corrections that can no longer be read back. readOverrides answers {}
       for these, so they have already vanished from the page, and the next
       write to that row lays a fresh object over the damage and makes the
       loss permanent. That belongs in front of somebody rather than being
       swallowed quietly. */
    unreadableCorrections: [
      ...rows(`SELECT id AS ref, name AS label, 'person' AS kind FROM holders
                WHERE overrides IS NOT NULL AND json_valid(overrides) = 0`),
      ...rows(`SELECT serial AS ref, serial AS label, 'asset' AS kind FROM devices
                WHERE overrides IS NOT NULL AND json_valid(overrides) = 0`),
    ],
    offRegister: rows(
      `SELECT id, name, department, devices_held AS n FROM holders
        WHERE hr_status = 'not on list' ORDER BY name COLLATE NOCASE`),
    noType: rows(
      `SELECT id, name, devices_held AS n FROM holders
        WHERE COALESCE(json_extract(overrides, '$.type'), base_type) = 'Unknown'
        ORDER BY name COLLATE NOCASE`),
  };
};

/* Runs one change and puts its ticket number on every change-log line that
   change wrote: the asset's, and the holder's own lines worked out again from
   it, which the routes underneath record without one. All in one transaction,
   so a change that fails leaves no lines and no ticket behind. */
export const stampTicket = (ticket, fn) => transaction(() => {
  const before = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM audit').get().n;
  const out = fn();
  db.prepare("UPDATE audit SET ticket = ? WHERE id > ? AND (ticket IS NULL OR ticket = '')").run(ticket, before);
  return out;
})();
