/* What the dashboard is made of, and the arithmetic behind each person's
 * choice of it. No page in here, so Node's test runner can read it too.
 *
 * A layout is saved in the browser, and the cards change between versions:
 * one saved by an older version names cards that are gone and lacks ones
 * that are new. Reading it keeps what still exists in the order it was put,
 * drops the rest, and adds every new card at the end, so the person's own
 * arrangement is never shuffled to make room.
 */
export const KEY = 'device-register.dashboard';

/* `takes` names the filters a card is narrowed by. Cards counted from
   people (the totals, the groups, the leavers) take group and department
   only; an asset type or a status says nothing about a person. */
const PEOPLE = ['group', 'department'];
const ALL = ['group', 'department', 'assetType', 'status'];
export const CARDS = [
  { id: 'totals', title: 'Totals', filterable: true, needsLog: false, takes: PEOPLE },
  { id: 'inventory', title: 'Laptops and iPads owned', filterable: false, needsLog: false, takes: [] },
  { id: 'recent', title: 'What has changed lately', filterable: false, needsLog: true, takes: [] },
  { id: 'mix', title: 'What each group holds', filterable: true, needsLog: false, takes: PEOPLE },
  { id: 'fleet', title: "The fleet in people's hands", filterable: true, needsLog: false, takes: ALL },
  { id: 'by-status', title: 'Assets by status', filterable: true, needsLog: false, takes: ALL },
  { id: 'by-department', title: 'By department', filterable: true, needsLog: false, takes: ALL },
  { id: 'to-retrieve', title: 'To retrieve', filterable: true, needsLog: false, takes: ALL },
  { id: 'defective', title: 'Defective', filterable: true, needsLog: false, takes: ALL },
  { id: 'undecided', title: 'Resigned, not decided', filterable: true, needsLog: false, takes: PEOPLE },
  { id: 'summary', title: 'Every asset, and their age', filterable: false, needsLog: false, takes: [] },
];

/** True when a filter that is set does not narrow this card, so the card
    can say so rather than look filtered when it is not. */
export function ignores(id, filters = {}) {
  const card = CARDS.find((c) => c.id === id);
  if (!card) return false;
  return ALL.some((key) => filters[key] && !card.takes.includes(key));
}

export const defaultLayout = (cards = CARDS) => cards.map((card) => ({ id: card.id, shown: true }));

export function mergeLayout(saved, cards = CARDS) {
  if (!Array.isArray(saved)) return defaultLayout(cards);
  const known = new Set(cards.map((card) => card.id));
  const seen = new Set();
  const out = [];
  for (const item of saved) {
    if (!item || typeof item !== 'object' || !known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, shown: item.shown !== false });
  }
  for (const card of cards) if (!seen.has(card.id)) out.push({ id: card.id, shown: true });
  return out;
}

export function readLayout(storage) {
  try {
    const raw = storage.getItem(KEY);
    return mergeLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultLayout();
  }
}

export function writeLayout(storage, layout) {
  try {
    storage.setItem(KEY, JSON.stringify(layout.map(({ id, shown }) => ({ id, shown: Boolean(shown) }))));
  } catch { /* storage blocked: the choice lasts until the page is closed */ }
}

/* ---------- filters ---------- */

export const isFiltered = (filters = {}) =>
  Boolean(filters.group || filters.department || filters.assetType || filters.status);

/** Group and department choose people; asset type and status choose
    assets. Once people are chosen, an asset counts only when it is in the
    hands of one of them, so hardware in stock drops out. */
export function applyFilters(holders, assets, { group = '', department = '', assetType = '', status = '' } = {}) {
  const choosingPeople = Boolean(group || department);
  const people = holders.filter((h) => (!group || h.type === group)
    && (!department || (h.department || '') === department));
  const ids = new Set(people.map((h) => h.id));
  const kept = assets.filter((a) => (!assetType || (a.asset_type || '') === assetType)
    && (!status || (a.status || '') === status)
    && (!choosingPeople || ids.has(a.holder_id)));
  return { holders: people, assets: kept };
}

const DAY = 24 * 60 * 60 * 1000;

export function periodStart(period, now = new Date()) {
  const days = { 7: 7, 30: 30, 90: 90 }[period];
  return days ? new Date(now.getTime() - days * DAY) : null;
}

/* ---------- counting ---------- */

export function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = String(row[key] ?? '').trim() || 'Not recorded';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].map(([value, n]) => ({ value, n }))
    .sort((a, b) => (b.n - a.n) || a.value.localeCompare(b.value));
}

/** Every laptop and iPad on the register, not only the ones handed out:
    how many are owned, how many are with somebody, how many are ready to
    hand out, and where the rest are, by status. `waiting` is the status
    word for hardware waiting to come back; those pieces are still with
    somebody, and are counted again on their own. */
export function inventoryTotals(assets, { waiting = '', ready = (status) => /availab/i.test(status) } = {}) {
  const blank = () => ({ owned: 0, withPeople: 0, ready: 0, other: 0, waiting: 0, others: new Map() });
  const out = { laptop: blank(), ipad: blank() };
  for (const a of assets) {
    const row = a.kind === 'Laptop' ? out.laptop : a.kind === 'iPad' ? out.ipad : null;
    if (!row) continue;
    const status = String(a.status || '').trim();
    row.owned += 1;
    if (waiting && status === waiting) row.waiting += 1;
    if (a.holder_id) { row.withPeople += 1; continue; }
    if (ready(status)) { row.ready += 1; continue; }
    row.other += 1;
    const word = status || 'Not recorded';
    row.others.set(word, (row.others.get(word) || 0) + 1);
  }
  for (const row of Object.values(out)) {
    row.others = [...row.others].map(([value, n]) => ({ value, n }))
      .sort((a, b) => (b.n - a.n) || a.value.localeCompare(b.value));
  }
  return out;
}

/** Laptops and iPads in somebody's hands, by model: the same thing the
    fleet card counts on the server, worked out from the rows in view. */
export function fleetOf(assets) {
  const counts = new Map();
  for (const a of assets) {
    if (!a.holder_id || (a.kind !== 'Laptop' && a.kind !== 'iPad')) continue;
    const model = String(a.model || '').trim() || 'Model not recorded';
    const key = `${model}\u0000${a.kind}`;
    const seen = counts.get(key) || { model, kind: a.kind, n: 0 };
    seen.n += 1;
    counts.set(key, seen);
  }
  return [...counts.values()].sort((a, b) => (b.n - a.n) || a.model.localeCompare(b.model));
}
