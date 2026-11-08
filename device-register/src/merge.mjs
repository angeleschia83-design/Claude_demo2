/* Changes handed back by somebody working in the offline copy.
 *
 * That copy has no database. It keeps corrections in the browser it was
 * opened in and hands them over as a block of text ending in one line of
 * JSON, which the person emails or messages back. This reads that block,
 * works out what applying it would do, and applies the parts that are
 * picked.
 *
 * Two things make the reading awkward, and both are handled here rather
 * than asked of the person sending it:
 *
 *   - The offline copy names its fields the way its own table does: res,
 *     pos, dept. The register names them resigned, position, department.
 *   - Email wraps a long line and quotes a forwarded one with ">". The JSON
 *     arrives broken across lines more often than not.
 */

/* What the offline copy calls a field, and what this one calls it. Both
   spellings are accepted so a file from either side reads. */
const KEYS = new Map([
  ['name', 'name'], ['type', 'type'],
  ['res', 'resigned'], ['resigned', 'resigned'],
  ['pos', 'position'], ['position', 'position'],
  ['dept', 'department'], ['department', 'department'],
  ['unit', 'unit'],
  ['lap', 'lap'], ['lapM', 'lapM'], ['ipd', 'ipd'], ['ipdM', 'ipdM'],
  ['rem', 'rem'], ['note', 'note'],
]);

const LABELS = new Map([
  ['name', 'Holder'], ['type', 'Type'], ['resigned', 'Resigned'],
  ['position', 'Position'], ['department', 'Department'], ['unit', 'Unit'],
  ['lap', 'Laptop serial'], ['lapM', 'Laptop model'],
  ['ipd', 'iPad serial'], ['ipdM', 'iPad model'],
  ['rem', 'Inventory remark'], ['note', 'Note'],
]);

const TYPES = new Set(['Sales', 'HO', 'Unknown']);
const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/* Reads the block back. Throws with something a person can act on. */
export function parseChanges(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('Paste what they sent you first.');

  /* Drop the "> " email adds to a forwarded line, then put the lines back
     together. A wrap normally replaced a space, so a space is put back; a
     wrap that fell mid-word did not, so that is tried second rather than
     given up on. */
  const lines = raw.replace(/\r/g, '').split('\n').map((line) => line.replace(/^[>|]+ ?/, ''));
  const carve = (flat) => {
    const start = flat.indexOf('{"v"');
    if (start >= 0) return flat.slice(start, flat.lastIndexOf('}') + 1);
    return flat.trimStart().startsWith('{') ? flat.trim() : null;
  };

  const tries = [carve(lines.join(' ')), carve(lines.join(''))].filter(Boolean);
  if (!tries.length) {
    throw new Error('That does not look like a set of changes. Paste the whole message, '
      + 'including the long line after "For IT to merge".');
  }

  let body = null;
  for (const json of tries) {
    try { body = JSON.parse(json); break; } catch { /* try the next reading */ }
  }
  if (!body) {
    throw new Error('The long line after "For IT to merge" came through broken — usually '
      + 'part of it was left behind when it was copied. Ask for it again, or ask them to '
      + 'send the file instead, which cannot break.');
  }

  const list = Array.isArray(body?.changes) ? body.changes : null;
  if (!list) throw new Error('That block carries no changes.');

  const entries = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String(entry.id ?? '').trim();
    const name = String(entry.name ?? '').trim();
    if (!id && !name) continue;

    const clean = (field, value) => (field === 'resigned'
      ? Boolean(value)
      : String(value ?? '').trim().slice(0, 500));

    const fields = [];
    if (entry.now && typeof entry.now === 'object') {
      /* v3: each change says what the copy started from as well. */
      for (const [key, value] of Object.entries(entry.now)) {
        const field = KEYS.get(key);
        if (!field) continue;
        fields.push({
          field,
          label: LABELS.get(field) || field,
          value: clean(field, value),
          from: key in (entry.was || {}) ? clean(field, entry.was[key]) : null,
        });
      }
    } else {
      /* v2: the value only, with the name riding along as a label whether
         or not it was edited. Whether the name really differs is settled
         against the register's own row. */
      for (const [key, value] of Object.entries(entry)) {
        if (key === 'id' || key === 'name') continue;
        const field = KEYS.get(key);
        if (!field) continue;
        fields.push({ field, label: LABELS.get(field) || field, value: clean(field, value), from: null });
      }
    }
    entries.push({ id, name, fields, dated: Boolean(entry.now) });
  }

  return {
    v: Number(body.v) || 2,
    from: String(body.from ?? '').trim().slice(0, 80),
    asOf: String(body.asOf ?? '').trim().slice(0, 40),
    entries,
  };
}

/* What applying it would do, judged against the register as it stands.
   Nothing is written here. */
export function planChanges(parsed, holders) {
  const byId = new Map(holders.map((row) => [row.id, row]));
  /* Matched on the name the workbook gave them as well as the name the
     register shows, because either side may have corrected it since. */
  const byName = new Map();
  for (const row of holders) {
    for (const name of [row.name, (row.base || {}).name]) {
      const key = norm(name);
      if (key && !byName.has(key)) byName.set(key, row);
    }
  }

  const seen = new Set();
  const rows = [];
  const add = (row) => {
    if (seen.has(row.key)) return;
    seen.add(row.key);
    rows.push(row);
  };

  for (const entry of parsed.entries) {
    const byTheId = byId.get(entry.id) || null;
    const byTheName = byName.get(norm(entry.name)) || null;
    let holder = byTheId || byTheName;
    let mixedUp = false;

    /* A newer copy carries the name the workbook gave the holder, which
       never changes as they edit. If that does not match the name against
       the same id here, the two sides mean different people by it —
       usually an older export — and nothing is applied on the id alone. */
    if (entry.dated && byTheId && entry.name
        && norm(entry.name) !== norm((byTheId.base || {}).name)) {
      holder = byTheName;
      mixedUp = !holder;
    }

    const fields = [...entry.fields];
    if (!entry.dated && holder && entry.name
        && norm(entry.name) !== norm((holder.base || {}).name)) {
      /* An older copy sends the name it is showing, edited or not, so a
         name that differs from the workbook's is a correction. */
      fields.push({ field: 'name', label: LABELS.get('name'), value: entry.name, from: null });
    }

    for (const change of fields) {
      const key = `${entry.id || entry.name}:${change.field}`;
      const asked = change.field === 'resigned'
        ? (change.value ? 'Yes' : 'No')
        : String(change.value ?? '');

      if (!holder) {
        add({ ...change, key, id: entry.id, holder: entry.name || entry.id,
              was: '', becomes: asked, state: 'missing',
              why: mixedUp
                ? 'Their copy has a different person under this record. Ask them for a fresh copy.'
                : 'No holder of that name in the register.' });
        continue;
      }
      if (change.field === 'type' && !TYPES.has(change.value)) {
        add({ ...change, key, id: holder.id, holder: holder.name,
              was: String(holder.type ?? ''), becomes: asked, state: 'missing',
              why: `"${asked}" is not a type this register knows.` });
        continue;
      }

      const text = (value) => (change.field === 'resigned'
        ? (value ? 'Yes' : 'No')
        : String(value ?? ''));
      const now = holder[change.field];
      const base = (holder.base || {})[change.field];
      const same = text(now) === text(change.value);

      /* Three sides to compare: what they started from, what they made of
         it, and what this register holds now. They agree, or a person
         decides. */
      const moved = change.from !== null
        ? text(now) !== text(change.from)
        : (change.field === 'resigned'
            ? Boolean(now) !== Boolean(base)
            : String(now ?? '') !== String(base ?? ''));

      add({
        ...change,
        key,
        id: holder.id,
        holder: holder.name,
        was: text(now),
        becomes: asked,
        started: change.from === null ? null : text(change.from),
        state: same ? 'same' : moved ? 'clash' : 'change',
        why: same || !moved ? '' : change.from !== null
          ? `They started from "${text(change.from) || '(empty)'}". It has been changed here since.`
          : 'This register has been changed here too.',
      });
    }
  }

  rows.sort((a, b) => String(a.holder).localeCompare(String(b.holder))
    || String(a.label).localeCompare(String(b.label)));

  const count = (state) => rows.filter((row) => row.state === state).length;
  return {
    from: parsed.from,
    asOf: parsed.asOf,
    rows,
    totals: {
      change: count('change'),
      clash: count('clash'),
      same: count('same'),
      missing: count('missing'),
    },
  };
}

/* The patches to write, one per holder, for the keys picked. */
export function patchesFor(plan, picked) {
  const wanted = new Set(picked || []);
  const byHolder = new Map();
  for (const row of plan.rows) {
    if (row.state === 'missing' || row.state === 'same') continue;
    if (!wanted.has(row.key)) continue;
    const patch = byHolder.get(row.id) || {};
    patch[row.field] = row.value;
    byHolder.set(row.id, patch);
  }
  return [...byHolder.entries()].map(([id, patch]) => ({ id, patch }));
}

export const mergeFields = [...LABELS.entries()].map(([key, label]) => ({ key, label }));
