/* The asset side of the register.
 *
 * Until now an asset was whatever the workbook said it was, and the only
 * thing a person could correct here was the holder. That left every
 * asset-level fix in the spreadsheet, which is where the two drifted apart.
 *
 * An asset now works the way a holder does: the workbook's row is the base,
 * corrections made here are laid over it and win, and an import refreshes
 * the base without touching them. Assets can also be added here, for
 * hardware that arrives between workbooks.
 *
 * Assigning is deliberately awkward where it should be. A serial already
 * out with somebody, a person who already holds one of that kind, a status
 * that says the thing is in for repair — each stops the assignment and asks
 * for a ticket number, which is then recorded against the change.
 */
import { db, readOverrides, recordChange, getHolder, updateHolder, listHolders, getNote } from './db.mjs';
import { norm as sameName, whyTheyMatch } from './name-match.mjs';

/* What a person may correct on an asset. The serial is the asset's identity
   rather than a field, so it is handled on its own. */
const EDITABLE = new Map([
  ['asset_type', 'Asset type'], ['kind', 'Kind'], ['model', 'Model'],
  ['status', 'Status'], ['age_years', 'Age in years'], ['os', 'Operating system'],
  ['host_name', 'Host name'], ['specs', 'Specification'], ['remarks', 'Remark'],
  ['assigned_on', 'Assigned on'],
  ['invoice_date', 'Invoice date'], ['purchased_on', 'Purchase date'],
]);
export const assetFields = [...EDITABLE.entries()].map(([key, label]) => ({ key, label }));

/* The three columns a person picks from rather than types into. */
export const LIST_KINDS = new Map([
  ['status', 'Status'], ['asset_type', 'Asset type'], ['model', 'Model'],
]);

const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const text = (value) => String(value ?? '').trim();
const today = () => new Date().toISOString().slice(0, 10);

/* The invoice and purchase dates are the only free-typed dates on an asset,
   and both are optional. Kept as YYYY-MM-DD, which is what the date picker
   sends, what sorts correctly, and what cannot be read as 3 April in one
   place and 4 March in another. Anything else is refused rather than stored
   and puzzled over later. */
const DATE_FIELDS = new Set(['invoice_date', 'purchased_on']);
const asDate = (value) => {
  const asked = text(value);
  if (!asked) return '';
  /* Read back rather than only parsed: 31 February parses, as 3 March, so a
     date that does not come back as it went in was never a real day. */
  const shaped = /^\d{4}-\d{2}-\d{2}$/.test(asked);
  const day = shaped ? new Date(`${asked}T00:00:00Z`) : null;
  if (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== asked) {
    throw new Error(`"${asked}" is not a date. Pick one from the calendar, or type it as YYYY-MM-DD.`);
  }
  return asked;
};

/* ---------- the controlled lists ---------- */

/* Seeded from what the workbook already uses, once, so nothing has to be
   named in advance. A status that reads as hardware nobody can hand out
   starts off not assignable; that is a flag an admin can change, not a rule
   buried in the code. */
const NOT_ASSIGNABLE = /retir|decommis|repair|check|lost|stolen|dispos|write.?off|scrap/i;

export const seedLists = db.transaction(() => {
  const seeded = db.prepare("SELECT COUNT(*) AS n FROM lists").get().n;
  if (seeded) return 0;
  const add = db.prepare(
    `INSERT OR IGNORE INTO lists (kind, value, added_at, added_by, assignable)
     VALUES (?, ?, ?, 'the workbook', ?)`,
  );
  let n = 0;
  const at = new Date().toISOString();
  for (const kind of LIST_KINDS.keys()) {
    const rows = db.prepare(
      `SELECT DISTINCT ${kind} AS value FROM devices WHERE ${kind} IS NOT NULL AND ${kind} <> ''`,
    ).all();
    for (const row of rows) {
      add.run(kind, row.value, at, kind === 'status' && NOT_ASSIGNABLE.test(row.value) ? 0 : 1);
      n += 1;
    }
  }
  return n;
});

export const listValues = (kind) => db.prepare(
  'SELECT value, assignable, retired, added_by, added_at FROM lists WHERE kind = ? ORDER BY value COLLATE NOCASE',
).all(kind).map((row) => ({ ...row, assignable: Boolean(row.assignable), retired: Boolean(row.retired) }));

export const allLists = () => Object.fromEntries(
  [...LIST_KINDS.keys()].map((kind) => [kind, listValues(kind)]),
);

const knows = (kind, value) => db.prepare(
  'SELECT 1 FROM lists WHERE kind = ? AND value = ? COLLATE NOCASE',
).get(kind, value);

export const addValue = db.transaction((kind, raw, actor) => {
  if (!LIST_KINDS.has(kind)) throw new Error('There is no such list.');
  const value = text(raw).slice(0, 80);
  if (!value) throw new Error('Give it a name first.');
  const clash = db.prepare('SELECT value FROM lists WHERE kind = ? AND value = ? COLLATE NOCASE')
    .get(kind, value);
  if (clash) {
    throw new Error(`"${clash.value}" is already on the ${LIST_KINDS.get(kind).toLowerCase()} list.`
      + (clash.value === value ? '' : ' Spelling it a second way is how a count goes wrong.'));
  }
  db.prepare(
    `INSERT INTO lists (kind, value, added_at, added_by, assignable) VALUES (?, ?, ?, ?, ?)`,
  ).run(kind, value, new Date().toISOString(), actor, kind === 'status' && NOT_ASSIGNABLE.test(value) ? 0 : 1);
  recordChange({ at: new Date().toISOString(), actor, field: `${kind} list`, was: '', now: value });
  return listValues(kind);
});

/** Deletes a word from a pick list, only when no asset uses it and the
    resign settings do not name it. */
export const deleteValue = db.transaction((kind, value, actor) => {
  if (!LIST_KINDS.has(kind)) throw new Error('There is no such list.');
  const row = db.prepare('SELECT value FROM lists WHERE kind = ? AND value = ?').get(kind, value);
  if (!row) throw new Error('That is not on the list.');
  const users = db.prepare(
    `SELECT COUNT(*) AS n FROM devices
      WHERE COALESCE(json_extract(overrides, '$.${kind}'), ${kind}) = ?`,
  ).get(value).n;
  if (users) {
    throw new Error(`"${value}" is in use on ${users} ${users === 1 ? 'asset' : 'assets'}. `
      + 'Change those first, then delete the word.');
  }
  const chosen = getNote('resign_statuses') || {};
  if (kind === 'status' && Object.values(chosen).includes(value)) {
    throw new Error(`"${value}" is chosen under When someone resigns. Pick another word there first.`);
  }
  db.prepare('DELETE FROM lists WHERE kind = ? AND value = ?').run(kind, value);
  recordChange({ at: new Date().toISOString(), actor, field: `${kind} list`, was: value, now: '' });
  return listValues(kind);
});

export const setValueFlag = db.transaction((kind, value, { assignable, retired }, actor) => {
  if (!LIST_KINDS.has(kind)) throw new Error('There is no such list.');
  const row = db.prepare('SELECT * FROM lists WHERE kind = ? AND value = ?').get(kind, value);
  if (!row) throw new Error('That is not on the list.');
  const at = new Date().toISOString();
  if (assignable !== undefined && Boolean(row.assignable) !== Boolean(assignable)) {
    db.prepare('UPDATE lists SET assignable = ? WHERE kind = ? AND value = ?')
      .run(assignable ? 1 : 0, kind, value);
    recordChange({ at, actor, field: `${value}: can be handed out`,
      was: row.assignable ? 'yes' : 'no', now: assignable ? 'yes' : 'no' });
  }
  if (retired !== undefined && Boolean(row.retired) !== Boolean(retired)) {
    db.prepare('UPDATE lists SET retired = ? WHERE kind = ? AND value = ?')
      .run(retired ? 1 : 0, kind, value);
    recordChange({ at, actor, field: `${value}: still offered`,
      was: row.retired ? 'no' : 'yes', now: retired ? 'no' : 'yes' });
  }
  return listValues(kind);
});

/* ---------- reading assets ---------- */

const ASSET_SELECT = `
  SELECT serial, asset_type, kind, model, status, holder_id, holder, assigned_on,
         age_years, os, host_name, specs, remarks,
         invoice_date, purchased_on, overrides,
         created_here, created_at, created_by,
         removed_at, removed_by, removed_reason
    FROM devices`;

const toAsset = (row) => {
  const { overrides, ...rest } = { ...row };
  const base = { ...rest, held: Boolean(rest.holder_id) };
  const carried = readOverrides(overrides);
  const keys = Object.keys(carried).filter((key) => EDITABLE.has(key) || key === 'holder_id' || key === 'holder');
  const merged = { ...base };
  for (const key of keys) merged[key] = carried[key];
  merged.held = Boolean(text(merged.holder_id));
  return { ...merged, base, changed: keys, createdHere: Boolean(row.created_here) };
};

export const listAssets = () => db.prepare(
  `${ASSET_SELECT} WHERE removed_at IS NULL ORDER BY serial COLLATE NOCASE`,
).all().map(toAsset);

/* Assets taken off the register, so they can be put back. */
export const listRemovedAssets = () => db.prepare(
  `${ASSET_SELECT} WHERE removed_at IS NOT NULL ORDER BY removed_at DESC`,
).all().map((row) => ({ ...toAsset(row), removed_at: row.removed_at, removed_by: row.removed_by,
  removed_reason: row.removed_reason }));
export const getAsset = (serial) => {
  const row = db.prepare(`${ASSET_SELECT} WHERE serial = ? COLLATE NOCASE`).get(serial);
  return row ? toAsset(row) : null;
};

/* getAsset answers for a removed asset too, which listRemovedAssets needs, so
   the routes that change one ask separately. Assigning a removed asset left a
   row that was both removed and held: hidden from the register, missing from
   the holder's list, and invisible to the guard that stops a holder being
   deleted while they still hold something. */
const isRemoved = (serial) => Boolean(
  db.prepare('SELECT removed_at FROM devices WHERE serial = ? COLLATE NOCASE')
    .get(serial)?.removed_at,
);

/* ---------- the holder's serial columns ---------- */

/* The holder table carries a laptop and iPad serial of its own, which came
   from the workbook. Once assets can be assigned here the two could drift,
   so after every assignment the holder's columns are worked out again from
   the assets themselves. A result equal to the workbook's clears the
   correction rather than leaving one that agrees. */
const KIND_FIELD = new Map([['Laptop', 'lap'], ['iPad', 'ipd']]);

const recomputeHolder = (holderId, actor, ticket) => {
  if (!holderId) return;
  const holder = getHolder(holderId);
  if (!holder) return;
  const assets = listAssets().filter((asset) => text(asset.holder_id) === holderId);
  const patch = {};
  for (const [kind, field] of KIND_FIELD) {
    const list = assets.filter((asset) => asset.kind === kind)
      .map((asset) => asset.serial).sort((a, b) => a.localeCompare(b));
    const now = list.join('; ');
    const was = (holder[field] || '').split(';').map((s) => s.trim()).filter(Boolean)
      .sort((a, b) => a.localeCompare(b)).join('; ');
    if (now !== was) patch[field] = now;
  }
  if (Object.keys(patch).length) updateHolder(holderId, patch, actor, ticket);
};

/* ---------- correcting an asset ---------- */

const writeOverrides = (serial, carried) => db.prepare('UPDATE devices SET overrides = ? WHERE serial = ?')
  .run(Object.keys(carried).length ? JSON.stringify(carried) : null, serial);

export const updateAsset = db.transaction((serial, patch, actor, ticket = null) => {
  const before = getAsset(serial);
  if (!before) return null;
  if (isRemoved(before.serial)) {
    throw new Error('That asset is off the register. Put it back before correcting it.');
  }
  const carried = { ...readOverrides(
    db.prepare('SELECT overrides FROM devices WHERE serial = ?').get(before.serial).overrides,
  ) };
  const at = new Date().toISOString();
  const changes = [];

  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE.has(key)) continue;
    let next = value === null ? null : text(value).slice(0, 300);
    if (next !== null && DATE_FIELDS.has(key)) next = asDate(next);

    /* A status, asset type or model has to be one of the words the register
       knows. Picking from a list is what stops "Retired/Decommissioned" and
       "retired/decommision" being two things. */
    if (next && LIST_KINDS.has(key) && !knows(key, next)) {
      throw new Error(`"${next}" is not on the ${LIST_KINDS.get(key).toLowerCase()} list. `
        + 'Add it there first, so it is spelled one way everywhere.');
    }

    const was = before[key];
    const sameAsBase = next !== null && text(next) === text(before.base[key]);
    if (next === null || sameAsBase) {
      if (!(key in carried)) continue;
      delete carried[key];
      changes.push([key, text(was), text(before.base[key])]);
      continue;
    }
    if (text(next) === text(was)) continue;
    carried[key] = next;
    changes.push([key, text(was), next]);
  }

  if (!changes.length) return before;
  writeOverrides(before.serial, carried);
  for (const [field, was, now] of changes) {
    recordChange({ at, actor, serial: before.serial, field, was, now, ticket });
  }
  /* `kind` decides which of the holder's serial columns this asset lands in,
     so changing it has to be carried through, or the holder goes on listing
     a laptop that is now an iPad and the counts contradict the row. */
  if (changes.some(([field]) => field === 'kind') && text(before.holder_id)) {
    recomputeHolder(text(before.holder_id), actor, ticket);
  }
  return getAsset(before.serial);
});

/* A serial typed wrongly is not a field to correct but an identity to move,
   so it gets its own path — and refuses to land on one already in use. */
export const renameAsset = db.transaction((serial, nextSerial, actor) => {
  const before = getAsset(serial);
  if (!before) return null;
  if (isRemoved(before.serial)) {
    throw new Error('That asset is off the register. Put it back before changing its serial.');
  }
  const next = text(nextSerial).slice(0, 120);
  if (!next) throw new Error('A serial cannot be empty.');
  if (norm(next) === norm(before.serial)) return before;
  const clash = db.prepare('SELECT serial FROM devices WHERE serial = ? COLLATE NOCASE').get(next);
  if (clash) {
    throw new Error(`${clash.serial} is already in the register. `
      + 'One serial is one piece of hardware, so the two have to be sorted out first.');
  }
  db.prepare('UPDATE devices SET serial = ? WHERE serial = ?').run(next, before.serial);
  db.prepare('UPDATE audit SET serial = ? WHERE serial = ?').run(next, before.serial);
  recordChange({ at: new Date().toISOString(), actor, serial: next, field: 'serial',
    was: before.serial, now: next });
  recomputeHolder(text(before.holder_id), actor);
  return getAsset(next);
});

/* ---------- adding something that is already there ---------- */

/* Where an asset is, in words, for the note shown when somebody tries to add
   it again: so they can go and find it rather than make a second record. */
const whereIs = (serial) => {
  const row = db.prepare('SELECT serial, removed_at, removed_reason FROM devices WHERE serial = ? COLLATE NOCASE').get(serial);
  const asset = row && getAsset(row.serial);
  if (!asset) return '';
  const what = [asset.asset_type || asset.kind, asset.model].filter(Boolean).join(' ');
  if (row.removed_at) {
    return `${what ? `${what}, ` : ''}taken off the register${row.removed_reason ? ` (${row.removed_reason})` : ''}. `
      + 'If it is back, an admin can put it back from "Assets taken off the register" under the Assets table';
  }
  if (asset.held) return `${what ? `${what}, ` : ''}with ${asset.holder || 'somebody'}`;
  return `${what ? `${what}, ` : ''}in stock${asset.status ? ` at "${asset.status}"` : ''}`;
};

/* A serial with its dashes, spaces and dots left out, so LAP001, lap 001 and
   LAP-001 are seen as the same label typed three ways. */
const serialKey = (serial) => text(serial).replace(/[^a-z0-9]/gi, '').toUpperCase();

/* Who a person is, in words: their group and department, what they hold,
   and whether they have left. */
const whoIs = (id) => {
  const holder = getHolder(id);
  if (!holder) return '';
  if (holder.merged_into) {
    const into = getHolder(holder.merged_into);
    return `folded into ${into ? into.name : holder.merged_into}, which is the record to use`;
  }
  const holds = listAssets().filter((asset) => asset.holder_id === id).map((asset) => asset.serial);
  return [
    [holder.type && holder.type !== 'Unknown' ? holder.type : '', holder.department].filter(Boolean).join(', '),
    holds.length ? `holds ${holds.join(', ')}` : 'holds nothing',
    holder.resigned ? 'marked resigned' : '',
  ].filter(Boolean).join('; ');
};

export const addAsset = db.transaction((body, actor) => {
  const serial = text(body?.serial).slice(0, 120);
  if (!serial) throw new Error('An asset needs a serial number.');
  /* The same serial is one piece of hardware, so it is never added twice,
     whatever is ticked. One typed with different dashes or spaces is
     probably the same label; it waits for a person to say it is not. */
  const clash = db.prepare('SELECT serial FROM devices WHERE serial = ? COLLATE NOCASE').get(serial);
  if (clash) {
    throw new Error(`${clash.serial} is already in the register: ${whereIs(clash.serial)}. `
      + 'Search for it on Assets instead of adding it again.');
  }
  if (!body?.confirm && serialKey(serial)) {
    const near = db.prepare('SELECT serial FROM devices').all()
      .filter((row) => serialKey(row.serial) === serialKey(serial));
    if (near.length) {
      return { possibleDuplicates: near.map((row) => ({ serial: row.serial, about: whereIs(row.serial) })) };
    }
  }

  /* `kind` decides the laptop and iPad columns on the holders table and how
     the fleet chart groups, and it is not in EDITABLE — so a typo here could
     never be corrected afterwards, only deleted and re-added. Checked against
     the kinds the register already uses rather than a list written here, for
     the same reason the status and model lists are seeded from the workbook. */
  const askedKind = text(body?.kind);
  if (askedKind) {
    const known = new Set(db.prepare("SELECT DISTINCT kind FROM devices WHERE kind <> ''")
      .all().map((r) => r.kind));
    known.add('Other');
    if (!known.has(askedKind)) {
      throw new Error(`"${askedKind}" is not a kind this register uses. `
        + `It uses: ${[...known].sort().join(', ')}.`);
    }
  }
  const row = { serial, kind: askedKind || 'Other' };
  for (const key of ['asset_type', 'model', 'status', 'age_years', 'os', 'host_name', 'specs', 'remarks']) {
    row[key] = text(body?.[key]).slice(0, 300);
  }
  /* Both optional: an asset bought years ago may have no paperwork to hand. */
  for (const key of DATE_FIELDS) row[key] = asDate(body?.[key]);
  for (const kind of LIST_KINDS.keys()) {
    if (row[kind] && !knows(kind, row[kind])) {
      throw new Error(`"${row[kind]}" is not on the ${LIST_KINDS.get(kind).toLowerCase()} list. `
        + 'Add it there first, so it is spelled one way everywhere.');
    }
  }

  const at = new Date().toISOString();
  db.prepare(`
    INSERT INTO devices (serial, asset_type, kind, model, status, held, holder_id, holder,
                         assigned_on, age_years, os, host_name, specs, remarks,
                         invoice_date, purchased_on,
                         created_here, created_at, created_by)
    VALUES (@serial, @asset_type, @kind, @model, @status, 0, NULL, NULL,
            '', @age_years, @os, @host_name, @specs, @remarks,
            @invoice_date, @purchased_on, 1, @at, @actor)
  `).run({ ...row, at, actor });
  recordChange({ at, actor, serial, field: 'added to the register', was: '',
    now: [row.asset_type, row.model].filter(Boolean).join(' ') || row.kind });
  return getAsset(serial);
});

/* ---------- adding a person ---------- */

/* Somebody who joined between workbooks. Their id is theirs for good, so a
   later import that does know them updates their row rather than making a
   second one. */
export const addHolder = db.transaction((body, actor) => {
  const name = text(body?.name).slice(0, 120);
  if (!name) throw new Error('A person needs a name.');
  /* The same name, whatever its capitals and spacing, is refused with who
     is already there. A name the duplicate finder would pair with somebody
     (a slip of a letter, surname first, a middle name more or less) waits
     for a person to say they really are two people. */
  const everyone = db.prepare('SELECT id, name, merged_into FROM holders').all();
  const clash = everyone.find((row) => sameName(row.name) === sameName(name));
  if (clash) {
    throw new Error(`${clash.name} is already in the register: ${whoIs(clash.id)}. `
      + 'Find them on People instead of adding them again.');
  }
  if (!body?.confirm) {
    const near = everyone.filter((row) => !row.merged_into)
      .map((row) => ({ row, verdict: whyTheyMatch(name, row.name) }))
      .filter(({ verdict }) => verdict)
      .sort((a, b) => a.verdict.rank - b.verdict.rank)
      .slice(0, 5);
    if (near.length) {
      return {
        possibleDuplicates: near.map(({ row, verdict }) => ({
          id: row.id, name: row.name, why: verdict.why, about: whoIs(row.id),
        })),
      };
    }
  }

  const type = ['Sales', 'HO', 'Unknown'].includes(body?.type) ? body.type : 'Unknown';
  /* Ordered as a number, not as text. Once N999 existed, 'N1000' sorted below
     it as a string, so this kept returning N999 and handing out N1000 for
     ever — a primary key clash on every add after the thousandth. GLOB keeps
     a stray non-numeric N-id out of the arithmetic. */
  const last = db.prepare(
    "SELECT id FROM holders WHERE id GLOB 'N[0-9]*' ORDER BY CAST(substr(id, 2) AS INTEGER) DESC LIMIT 1",
  ).get();
  const id = `N${String((last ? Number(last.id.slice(1)) : 0) + 1).padStart(3, '0')}`;
  const at = new Date().toISOString();

  db.prepare(`
    INSERT INTO holders (id, name, base_type, device_status, position, department, unit, division,
                         ad_id, email, laptops_held, ipads_held, devices_held,
                         laptop_serial, laptop_model, ipad_serial, ipad_model,
                         remarks, label_source, hr_status, base_resigned, last_working_day,
                         created_here, created_at, created_by)
    VALUES (@id, @name, @type, 'No device', @position, @department, @unit, '',
            '', @email, 0, 0, 0, '', '', '', '', '', 'added here', 'not on list', 0, '',
            1, @at, @actor)
  `).run({
    id, name, type, at, actor,
    position: text(body?.position).slice(0, 200),
    department: text(body?.department).slice(0, 200),
    unit: text(body?.unit).slice(0, 200),
    email: text(body?.email).slice(0, 200),
  });
  recordChange({ at, actor, holderId: id, field: 'added to the register', was: '', now: name });
  return getHolder(id);
});

/* ---------- handing hardware out and taking it back ---------- */

/* Why an assignment should stop and ask. Each one is a thing that is
   usually a mistake and occasionally deliberate, which is what a ticket
   number is for: it says somebody decided, and who to ask about it later. */
export const assignReasons = (asset, holder) => {
  const reasons = [];
  const current = text(asset.holder_id);
  if (current && current !== holder.id) {
    reasons.push({
      code: 'already_out',
      say: `${asset.serial} is already assigned to ${asset.holder || current}`
        + `${asset.assigned_on ? `, since ${asset.assigned_on}` : ''}.`,
    });
  }
  const sameKind = listAssets().filter((other) => text(other.holder_id) === holder.id
    && other.kind === asset.kind && other.serial !== asset.serial);
  if (sameKind.length) {
    const label = asset.kind === 'Other' ? 'asset' : asset.kind.toLowerCase();
    reasons.push({
      code: 'already_has',
      say: `${holder.name} already holds ${sameKind.length === 1 ? 'a' : sameKind.length} ${label}`
        + `${sameKind.length === 1 ? '' : 's'}: ${sameKind.map((a) => a.serial).join(', ')}.`,
    });
  }
  const status = text(asset.status);
  if (status) {
    const known = db.prepare('SELECT assignable FROM lists WHERE kind = ? AND value = ?').get('status', status);
    if (known && !known.assignable) {
      reasons.push({ code: 'status', say: `${asset.serial} is marked "${status}", which is not hardware to hand out.` });
    }
  }
  if (holder.resigned) {
    reasons.push({ code: 'resigned', say: `${holder.name} is marked resigned.` });
  }
  return reasons;
};

/** What a hand-out would run into, without making it: the page asks this
    before the ticket goes in, so the warning is read before anything is
    handed to a leaver or to a second person. */
export const previewAssign = (serial, holderId) => {
  const asset = getAsset(serial);
  if (!asset) return { error: 'No asset with that serial.' };
  const holder = getHolder(holderId);
  if (!holder) return { error: 'No such person in the register.' };
  return { reasons: text(asset.holder_id) === holder.id ? [] : assignReasons(asset, holder) };
};

export const assignAsset = db.transaction((serial, holderId, { actor, ticket = null } = {}) => {
  const asset = getAsset(serial);
  if (!asset) return { error: 'No asset with that serial.' };
  if (isRemoved(asset.serial)) {
    return { error: 'That asset is off the register. Put it back before handing it out.' };
  }
  const holder = getHolder(holderId);
  if (!holder) return { error: 'No such person in the register.' };
  if (text(asset.holder_id) === holder.id) {
    return { asset, holder, already: true };
  }

  const reasons = assignReasons(asset, holder);
  const note = text(ticket).slice(0, 60);
  if (reasons.length && !note) return { reasons, asset, holder, needTicket: true };

  const at = new Date().toISOString();
  const previous = text(asset.holder_id);
  const carried = { ...readOverrides(
    db.prepare('SELECT overrides FROM devices WHERE serial = ?').get(asset.serial).overrides,
  ) };
  carried.holder_id = holder.id;
  carried.holder = holder.name;
  carried.assigned_on = today();
  /* Something in somebody's hands is assigned, whatever the sheet said. */
  /* "Unassigned" and "Reassigned" both contain "ssigned", and there was no
     ORDER BY — so whichever row SQLite happened to hand back first became the
     status of a hand-out, possibly "Unassigned", and possibly a different
     answer on the next run. */
  const assigned = db.prepare(
    `SELECT value FROM lists
      WHERE kind = 'status' AND assignable = 1 AND retired = 0
        AND lower(value) LIKE '%assigned%'
        AND lower(value) NOT LIKE '%unassigned%'
        AND lower(value) NOT LIKE '%reassigned%'
        AND lower(value) NOT LIKE '%not assigned%'
      ORDER BY length(value), value
      LIMIT 1`,
  ).get();
  if (assigned) carried.status = assigned.value;
  writeOverrides(asset.serial, carried);

  recordChange({ at, actor, serial: asset.serial, holderId: holder.id, field: 'assigned to',
    was: asset.holder || previous || '(nobody)', now: holder.name, ticket: note || null });
  if (assigned && assigned.value !== asset.status) {
    recordChange({ at, actor, serial: asset.serial, field: 'status',
      was: asset.status, now: assigned.value, ticket: note || null });
  }
  for (const id of new Set([previous, holder.id].filter(Boolean))) recomputeHolder(id, actor, note || null);

  return { asset: getAsset(asset.serial), holder: getHolder(holder.id), reasons, ticket: note || null };
});

export const returnAsset = db.transaction((serial, { actor, status, ticket = null } = {}) => {
  const asset = getAsset(serial);
  if (!asset) return { error: 'No asset with that serial.' };
  const previous = text(asset.holder_id);
  if (!previous) return { asset, already: true };

  const next = text(status);
  if (next && !knows('status', next)) {
    return { error: `"${next}" is not on the status list. Add it there first.` };
  }
  const at = new Date().toISOString();
  const carried = { ...readOverrides(
    db.prepare('SELECT overrides FROM devices WHERE serial = ?').get(asset.serial).overrides,
  ) };
  carried.holder_id = '';
  carried.holder = '';
  carried.assigned_on = '';
  if (next) carried.status = next;
  writeOverrides(asset.serial, carried);

  recordChange({ at, actor, serial: asset.serial, holderId: previous, field: 'returned by',
    was: asset.holder || previous, now: '(nobody)', ticket: text(ticket) || null });
  if (next && next !== asset.status) {
    recordChange({ at, actor, serial: asset.serial, field: 'status', was: asset.status, now: next });
  }
  recomputeHolder(previous, actor);
  return { asset: getAsset(asset.serial), returnedBy: previous };
});

/* ---------- one person entered twice ---------- */

/* Folding, not deleting. The workbook goes on producing both spellings, so
   a deleted record comes back at the next import with its hardware
   attached; a folded one stays folded. Nothing is destroyed either, which
   is what makes it safe to do on a maybe — it can be put back. */
export const mergeHolders = db.transaction((loserId, keeperId, actor) => {
  if (loserId === keeperId) return { error: 'Those are the same record.' };
  const loser = getHolder(loserId);
  const keeper = getHolder(keeperId);
  if (!loser || !keeper) return { error: 'One of those records is not in the register.' };
  /* Folding something already folded, or into something already folded, makes
     a chain the register cannot show: both rows drop out of the holder list
     and their hardware belongs to nobody visible. Two folds in opposite
     directions make a cycle that hides both people for good. foldAll resolves
     chains before it calls this; the single-pair route did not. */
  for (const row of db.prepare('SELECT id, merged_into FROM holders WHERE id IN (?, ?)')
    .all(loserId, keeperId)) {
    if (!row.merged_into) continue;
    return row.id === keeperId
      ? { error: 'That record is itself folded into another. Fold into the kept one instead.' }
      : { error: 'That record is already folded into another. Put it back first.' };
  }

  const at = new Date().toISOString();
  const mine = listAssets().filter((asset) => text(asset.holder_id) === loser.id
    || (!text(asset.holder_id) && text(asset.holder) && norm(asset.holder) === norm(loser.name)));

  for (const asset of mine) {
    const carried = { ...readOverrides(
      db.prepare('SELECT overrides FROM devices WHERE serial = ?').get(asset.serial).overrides,
    ) };
    carried.holder_id = keeper.id;
    carried.holder = keeper.name;
    writeOverrides(asset.serial, carried);
    recordChange({ at, actor, serial: asset.serial, holderId: keeper.id, field: 'assigned to',
      was: loser.name, now: keeper.name });
  }

  /* What the folded record knew and the kept one does not. A name is never
     folded: the kept record's name is the one being kept. */
  const carry = ['position', 'department', 'unit', 'type', 'note', 'rem'];
  const patch = {};
  for (const key of carry) {
    const theirs = key === 'type' ? loser.type : loser[key];
    const ours = key === 'type' ? keeper.type : keeper[key];
    if (!text(theirs) || text(ours)) continue;
    if (key === 'type' && theirs === 'Unknown') continue;
    patch[key] = theirs;
  }
  if (loser.resigned && !keeper.resigned) patch.resigned = true;
  if (Object.keys(patch).length) updateHolder(keeper.id, patch, actor);

  db.prepare('UPDATE holders SET merged_into = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(keeper.id, at, actor, loser.id);
  recordChange({ at, actor, holderId: loser.id, field: 'folded into',
    was: loser.name, now: `${keeper.name} (${keeper.id})` });

  recomputeHolder(keeper.id, actor);
  return { keeper: getHolder(keeper.id), moved: mine.length, folded: loser.name };
});

export const unmergeHolders = db.transaction((id, actor) => {
  const row = db.prepare('SELECT id, name, merged_into FROM holders WHERE id = ?').get(id);
  if (!row) return { error: 'No such record.' };
  if (!row.merged_into) return { error: 'That record is not folded into another.' };
  db.prepare('UPDATE holders SET merged_into = NULL WHERE id = ?').run(id);
  recordChange({ at: new Date().toISOString(), actor, holderId: id, field: 'put back',
    was: `folded into ${row.merged_into}`, now: 'its own record' });
  /* Hardware moved by the fold stays where it was moved to; whoever puts a
     record back decides what it should hold. */
  return { holder: getHolder(id) };
});

export const listMerged = () => db.prepare(
  `SELECT a.id, a.name, a.merged_into, b.name AS into_name, a.updated_at, a.updated_by
     FROM holders a LEFT JOIN holders b ON b.id = a.merged_into
    WHERE a.merged_into IS NOT NULL ORDER BY a.name COLLATE NOCASE`,
).all().map((row) => ({ ...row }));

/* Deleting is for a record somebody typed here by mistake, and only while
   it holds nothing. Anything from the workbook is folded instead, or the
   next import simply brings it back. */
export const deleteHolder = db.transaction((id, actor) => {
  /* Any record, not only one typed in here: the workbook is retired, so
     there is no next import to bring a deleted one back. */
  const row = db.prepare('SELECT id, name, created_here FROM holders WHERE id = ?').get(id);
  if (!row) return { error: 'No such record.' };
  const holding = listAssets().filter((asset) => text(asset.holder_id) === id);
  if (holding.length) {
    return {
      error: `${row.name} still holds ${holding.length} `
        + `${holding.length === 1 ? 'asset' : 'assets'} (${holding.map((a) => a.serial).join(', ')}). `
        + 'Take those back first, so the hardware is not lost with the record.',
    };
  }
  /* A fold is the only thing keeping the folded record out of the holder
     list. Delete the keeper and those records point at nothing and are
     invisible for good, with listMerged showing a blank name beside them. */
  const foldedIn = db.prepare('SELECT COUNT(*) AS n FROM holders WHERE merged_into = ?').get(id).n;
  if (foldedIn) {
    return {
      error: `${row.name} has ${foldedIn} record${foldedIn === 1 ? '' : 's'} folded into it. `
        + 'Put those back first, or they would be left pointing at a record that is gone.',
    };
  }
  db.prepare('DELETE FROM holders WHERE id = ?').run(id);
  recordChange({ at: new Date().toISOString(), actor, holderId: id, field: 'removed from the register',
    was: row.name, now: '' });
  return { removed: row.name };
});

/* ---------- folding every pair at once ---------- */

/* Which of the two to keep. The register already knows how each name
   matched HR's own employee list, and that is the best evidence available:
   a record HR spells exactly that way is the real spelling, and the other
   is what somebody typed into the inventory. After that: whoever holds
   more hardware, then the fuller name, then the older record. */
const HR_RANK = new Map([
  ['exact name', 0], ['first name', 1], ['whole name', 2],
  ['spelling', 3], ['name halves swapped', 4],
]);

const hrRank = (row) => {
  const source = text(row.src).toLowerCase();
  if (!source || source === 'not found') return 9;
  for (const [phrase, rank] of HR_RANK) {
    if (source.includes(phrase)) return rank;
  }
  return 8;
};

export const whichToKeep = (a, b) => {
  const score = (row) => [hrRank(row), -(row.n || 0), -text(row.name).split(/\s+/).length];
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return sa[i] < sb[i] ? a : b;
  }
  return String(a.id) <= String(b.id) ? a : b;
};

const keepBecause = (keeper, other) => {
  if (hrRank(keeper) < hrRank(other)) {
    return hrRank(keeper) === 0
      ? 'HR’s list spells it exactly this way.'
      : `HR’s list is a closer match to this spelling (${text(keeper.src)}).`;
  }
  if ((keeper.n || 0) > (other.n || 0)) return 'This record holds more of the hardware.';
  if (text(keeper.name).split(/\s+/).length > text(other.name).split(/\s+/).length) {
    return 'This is the fuller name.';
  }
  return 'Neither record had anything to choose between them, so the older one was kept.';
};

/* Every pair, in one go, most certain first. Each fold is the same one a
   person would do by hand, and each can be put back the same way. */
export const foldAll = db.transaction((actor, { pairs } = {}) => {
  const report = [];
  const moved = new Map();          // a folded id -> the record it went into

  const resolve = (id) => {
    let at = id;
    const seen = new Set();
    while (moved.has(at) && !seen.has(at)) { seen.add(at); at = moved.get(at); }
    return at;
  };

  for (const pair of pairs) {
    const live = listHolders();
    const first = live.find((row) => row.id === resolve(pair.people[0].id));
    const second = live.find((row) => row.id === resolve(pair.people[1].id));
    if (!first || !second || first.id === second.id) continue;

    const keeper = whichToKeep(first, second);
    const loser = keeper.id === first.id ? second : first;
    const why = keepBecause(keeper, loser);

    const out = mergeHolders(loser.id, keeper.id, actor);
    if (out.error) {
      report.push({ kept: keeper.name, folded: loser.name, error: out.error });
      continue;
    }
    moved.set(loser.id, keeper.id);
    report.push({
      kept: keeper.name, keptId: keeper.id, folded: loser.name, foldedId: loser.id,
      moved: out.moved, now: out.keeper.n, why, rank: pair.rank,
    });
  }

  return { report, folded: report.filter((row) => !row.error).length };
});

/* ---------- an asset that should not be on the register ---------- */

/* Deleting outright is for something typed in here by mistake. Anything
   the workbook lists is taken off the register instead and stays off: a
   deleted row would be back at the next import, hardware and all. Either
   way it has to be in nobody's hands first, so the record of who had it is
   not lost with it. */
export const removeAsset = db.transaction((serial, { actor, reason, hard = false } = {}) => {
  const asset = getAsset(serial);
  if (!asset) return { error: 'No asset with that serial.' };
  if (text(asset.holder_id) || text(asset.holder)) {
    return {
      error: `${asset.serial} is still with ${asset.holder || 'somebody'}. Take it back first, `
        + 'so who had it is not lost along with the record.',
    };
  }

  const at = new Date().toISOString();
  const why = text(reason).slice(0, 200);

  /* Something added here has no workbook row to come back from, so it can
     go for good — and only then. */
  if (hard) {
    db.prepare('DELETE FROM devices WHERE serial = ?').run(asset.serial);
    recordChange({ at, actor, serial: asset.serial, field: 'deleted from the register',
      was: [asset.asset_type, asset.model].filter(Boolean).join(' ') || asset.kind, now: why });
    return { deleted: asset.serial };
  }

  /* Taking off an asset that is already off overwrote removed_at, removed_by
     and the reason, and logged a second entry — losing who first took it off
     and why. */
  if (isRemoved(asset.serial)) return { already: true, removed: asset.serial };

  db.prepare('UPDATE devices SET removed_at = ?, removed_by = ?, removed_reason = ? WHERE serial = ?')
    .run(at, actor, why, asset.serial);
  recordChange({ at, actor, serial: asset.serial, field: 'taken off the register',
    was: asset.status || '(no status)', now: why || 'no reason given' });
  return { removed: asset.serial, reason: why };
});

export const restoreAsset = db.transaction((serial, actor) => {
  /* Case-insensitively, like every other serial lookup here. Matching exactly
     meant restore refused a serial the rest of the app resolves without
     complaint. */
  const row = db.prepare('SELECT serial, removed_at FROM devices WHERE serial = ? COLLATE NOCASE')
    .get(serial);
  if (!row) return { error: 'No asset with that serial.' };
  if (!row.removed_at) return { error: 'That asset is on the register already.' };
  db.prepare('UPDATE devices SET removed_at = NULL, removed_by = NULL, removed_reason = NULL WHERE serial = ?')
    .run(row.serial);
  recordChange({ at: new Date().toISOString(), actor, serial: row.serial,
    field: 'put back on the register', was: 'off the register', now: 'on it' });
  return { asset: getAsset(row.serial) };
});
