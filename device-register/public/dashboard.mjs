/* The dashboard each person chooses.
 *
 * Every card can be shown or hidden and moved up or down, and the filters
 * at the top narrow every card that can take them. The choice is kept in
 * this browser, so two people at two desks each see their own.
 *
 * With no filter set, the cards the register always had are drawn exactly
 * as before, from the server's own counts. With one set, the page works
 * them out from the rows it already holds.
 */
const version = new URL(import.meta.url).search;
const {
  CARDS, readLayout, writeLayout, defaultLayout,
  applyFilters, isFiltered, periodStart, countBy, fleetOf, ignores, inventoryTotals,
} = await import(`./layout.mjs${version}`);

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en');
const FILTERS_KEY = 'device-register.dashboard-filters';
const BLANK = { group: '', department: '', assetType: '', status: '', period: 'all' };

/* localStorage itself can throw on being touched, not only on use. */
const storage = (() => {
  try { return window.localStorage; } catch { return null; }
})() || { getItem() { throw new Error('no storage'); }, setItem() { throw new Error('no storage'); } };

let reg = null;
let layout = readLayout(storage);
let filters = (() => {
  try { return { ...BLANK, ...JSON.parse(storage.getItem(FILTERS_KEY) || '{}') }; } catch { return { ...BLANK }; }
})();
let RETRIEVE = { status: null, rows: [] };
let STATUSES = null;
let editing = false;

const grid = $('dash-grid');
const cardEl = (id) => grid.querySelector(`[data-card="${id}"]`);
const titleOf = (id) => (CARDS.find((card) => card.id === id) || {}).title || id;
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const pieces = (n) => `${nf.format(n)} ${n === 1 ? 'piece' : 'pieces'}`;

const saveFilters = () => {
  try { storage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* storage blocked */ }
};

/* ---------- the cards' order and visibility ---------- */

function applyLayout() {
  for (const item of layout) {
    const card = cardEl(item.id);
    if (!card) continue;
    grid.append(card);
    card.toggleAttribute('data-off', !item.shown);
  }
}

function move(id, step) {
  /* A card this role never sees (the change log, for a viewer) is skipped
     over, so Move up always visibly moves. */
  const visible = layout.filter((item) => cardEl(item.id) && !cardEl(item.id).hidden);
  const at = visible.findIndex((item) => item.id === id);
  const other = visible[at + step];
  if (!other) return;
  const a = layout.findIndex((item) => item.id === id);
  const b = layout.findIndex((item) => item.id === other.id);
  [layout[a], layout[b]] = [layout[b], layout[a]];
  writeLayout(storage, layout);
  applyLayout();
  drawEditBars();
  const again = cardEl(id).querySelector(`.dash-edit [data-step="${step}"]`);
  if (again && !again.disabled) again.focus();
}

function drawEditBars() {
  for (const bar of grid.querySelectorAll('.dash-edit')) bar.remove();
  if (!editing) return;
  const visible = layout.filter((item) => cardEl(item.id) && !cardEl(item.id).hidden);
  visible.forEach((item, index) => {
    const card = cardEl(item.id);
    const title = titleOf(item.id);
    const show = el('input', { type: 'checkbox', checked: item.shown });
    show.addEventListener('change', () => {
      item.shown = show.checked;
      writeLayout(storage, layout);
      applyLayout();
    });
    const up = el('button', { type: 'button', className: 'btn btn-quiet btn-small', textContent: 'Move up', disabled: index === 0 });
    up.dataset.step = '-1';
    up.setAttribute('aria-label', `Move ${title} up`);
    up.addEventListener('click', () => move(item.id, -1));
    const down = el('button', { type: 'button', className: 'btn btn-quiet btn-small', textContent: 'Move down', disabled: index === visible.length - 1 });
    down.dataset.step = '1';
    down.setAttribute('aria-label', `Move ${title} down`);
    down.addEventListener('click', () => move(item.id, 1));
    card.prepend(el('div', { className: 'dash-edit' },
      el('label', { className: 'tick' }, show, el('span', { textContent: `Show ${title}` })),
      el('span', { className: 'dash-edit-move' }, up, down)));
  });
}

function setEditing(on) {
  editing = on;
  grid.classList.toggle('is-editing', on);
  $('dash-editing').hidden = !on;
  $('dash-choose').hidden = on;
  drawEditBars();
  if (on) {
    const first = grid.querySelector('.dash-edit input');
    if (first) first.focus();
  } else {
    $('dash-choose').focus();
  }
}

/* ---------- the filters ---------- */

function fillSelect(id, values, current) {
  const select = $(id);
  const first = select.options[0];
  select.replaceChildren(first, ...values.map((value) => new Option(value, value)));
  select.value = values.includes(current) ? current : '';
}

function fillFilters() {
  const holders = reg.holders();
  const assets = reg.assets ? reg.assets() : [];
  const sorted = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('f-group').value = filters.group;
  fillSelect('f-dept', sorted(holders.map((h) => h.department)), filters.department);
  fillSelect('f-type', sorted(assets.map((a) => a.asset_type)), filters.assetType);
  fillSelect('f-status', sorted(assets.map((a) => a.status)), filters.status);
  $('f-period').value = filters.period;
}

function describeFilters() {
  const bits = [];
  if (filters.group) bits.push({ Sales: 'Sales', HO: 'head office', Unknown: 'people with no type' }[filters.group]);
  if (filters.department) bits.push(filters.department);
  if (filters.assetType) bits.push(filters.assetType);
  if (filters.status) bits.push(`at "${filters.status}"`);
  return bits.length ? `Showing ${bits.join(', ')} only.` : ' ';
}

/* ---------- the new cards ---------- */

function bars(box, rows, empty) {
  box.replaceChildren();
  if (!rows.length) { box.append(el('p', { className: 'muted', textContent: empty })); return; }
  const max = rows[0].n || 1;
  for (const row of rows) {
    const fill = el('div', { className: 'fleet-fill' });
    fill.style.width = `${Math.max(2, (row.n / max) * 100)}%`;
    box.append(el('div', { className: 'fleet-row', title: `${row.value}: ${nf.format(row.n)}` },
      el('div', { className: 'm', textContent: row.value }),
      el('div', { className: 'fleet-track' }, fill),
      el('div', { className: 'c', textContent: nf.format(row.n) })));
  }
}

function drawByDepartment(holders, assets) {
  const rows = new Map();
  for (const h of holders) {
    const name = (h.department || '').trim() || 'No department recorded';
    const row = rows.get(name) || { name, people: 0, holding: 0, held: 0 };
    const mine = assets.filter((a) => a.holder_id === h.id).length;
    row.people += 1;
    row.holding += mine ? 1 : 0;
    row.held += mine;
    rows.set(name, row);
  }
  const body = $('d-dept');
  body.replaceChildren();
  const list = [...rows.values()].sort((a, b) => (b.held - a.held) || a.name.localeCompare(b.name));
  for (const row of list) {
    body.append(el('tr', {},
      el('td', { textContent: row.name }),
      el('td', { className: 'num', textContent: nf.format(row.people) }),
      el('td', { className: 'num', textContent: nf.format(row.holding) }),
      el('td', { className: 'num', textContent: nf.format(row.held) })));
  }
  if (!list.length) {
    body.append(el('tr', {}, el('td', { colSpan: 4, className: 'empty', textContent: 'Nobody matches these filters.' })));
  }
}

function drawToRetrieve(holders) {
  const ids = new Set(holders.map((h) => h.id));
  const choosingPeople = Boolean(filters.group || filters.department);
  const rows = RETRIEVE.rows.filter((row) => (!choosingPeople || ids.has(row.holder_id))
    && (!filters.assetType || (row.asset_type || '') === filters.assetType)
    && (!filters.status || filters.status === RETRIEVE.status));
  $('d-retrieve-line').textContent = rows.length
    ? `${pieces(rows.length)} waiting to come back. The longest waiting:`
    : 'Nothing is waiting to come back.';
  const list = $('d-retrieve');
  list.replaceChildren(...rows.slice(0, 5).map((row) => el('li', {},
    el('span', { className: 'mono', textContent: row.serial }),
    el('span', { textContent: row.holder || 'Nobody' }),
    el('span', { className: 'muted', textContent: row.since ? `since ${row.since}` : 'date not recorded' }))));
}

function drawDefective(assets) {
  const word = STATUSES && STATUSES.defective.value;
  const list = $('d-defective');
  if (!word) {
    $('d-defective-line').textContent = 'Nothing is marked defective yet.';
    list.replaceChildren();
    return;
  }
  const broken = assets.filter((a) => a.status === word);
  $('d-defective-line').textContent = broken.length
    ? `${pieces(broken.length)} at "${word}", by kind:`
    : `Nothing is at "${word}".`;
  list.replaceChildren(...countBy(broken, 'kind').map((row) => el('li', {},
    el('span', { textContent: row.value }),
    el('span', { className: 'num', textContent: nf.format(row.n) }))));
}

function drawUndecided(holders) {
  const waiting = RETRIEVE.status;
  const everything = reg.assets ? reg.assets() : [];
  const open = holders.filter((h) => h.resigned
    && everything.some((a) => a.holder_id === h.id && a.status !== waiting));
  $('d-undecided-line').textContent = open.length
    ? `${nf.format(open.length)} ${open.length === 1 ? 'leaver still holds' : 'leavers still hold'} hardware nobody has decided about.`
    : 'Every leaver’s hardware has been decided.';
  const items = open.slice(0, 5).map((h) => el('li', {}, el('span', { textContent: h.name })));
  if (open.length && reg.canEdit()) {
    const go = el('button', { type: 'button', className: 'btn btn-quiet btn-small', textContent: 'Open Needs attention' });
    go.addEventListener('click', () => window.registerTabs && window.registerTabs.show('attention'));
    items.push(el('li', {}, go));
  }
  $('d-undecided').replaceChildren(...items);
}

/* Every laptop and iPad owned, whatever the filters say: the question it
   answers is "how many do we have", not "how many does this group hold". */
function drawInventory() {
  const assets = reg.assets ? reg.assets() : [];
  const readyWord = STATUSES && STATUSES.available && STATUSES.available.value;
  const totals = inventoryTotals(assets, {
    waiting: RETRIEVE.status || '',
    ready: (status) => status === readyWord || /availab/i.test(status),
  });
  const body = $('d-inventory');
  body.replaceChildren();
  const notes = [];
  for (const [label, row] of [['Laptops', totals.laptop], ['iPads', totals.ipad]]) {
    body.append(el('tr', {},
      el('th', { scope: 'row', textContent: label }),
      ...[row.owned, row.withPeople, row.ready, row.other].map((n) => el('td', { className: 'num', textContent: nf.format(n) }))));
    if (row.other) {
      notes.push(el('li', {}, el('span', { textContent: `${label} elsewhere: ${row.others.map((o) => `${o.value} ${nf.format(o.n)}`).join(', ')}` })));
    }
    if (row.waiting) {
      notes.push(el('li', {}, el('span', { textContent: `${label} with people include ${nf.format(row.waiting)} waiting to come back.` })));
    }
  }
  $('d-inventory-notes').replaceChildren(...notes);
}

/* ---------- drawing ---------- */

function redraw() {
  if (!reg) return;
  const holders = reg.holders();
  const assets = reg.assets ? reg.assets() : [];
  const view = applyFilters(holders, assets, filters);
  const on = isFiltered(filters);

  if (on) {
    reg.draw.tiles(view.holders);
    reg.draw.mix(view.holders);
    reg.draw.fleet(fleetOf(view.assets));
  } else {
    reg.draw.tiles();
    reg.draw.mix();
    reg.draw.fleet();
  }
  bars($('d-status'), countBy(view.assets, 'status'), 'No asset matches these filters.');
  drawByDepartment(view.holders, view.assets);
  drawToRetrieve(view.holders);
  drawDefective(view.assets);
  drawUndecided(view.holders);
  drawInventory();

  /* Each card says when a filter that is set does not narrow it. */
  for (const card of grid.querySelectorAll('[data-card]')) {
    const note = card.querySelector('.dash-note');
    if (note) note.hidden = !ignores(card.dataset.card, filters);
  }
  $('dash-clear').hidden = !on;
  $('dash-line').textContent = describeFilters();
}

/* app.js asks for these once for the whole page. */
function loadExtras() {
  ({ retrieve: RETRIEVE, statuses: STATUSES } = reg.extras());
}

function onFilterChange() {
  filters = {
    group: $('f-group').value,
    department: $('f-dept').value,
    assetType: $('f-type').value,
    status: $('f-status').value,
    period: $('f-period').value,
  };
  saveFilters();
  redraw();
}

for (const id of ['f-group', 'f-dept', 'f-type', 'f-status']) $(id).addEventListener('change', onFilterChange);
$('f-period').addEventListener('change', () => {
  onFilterChange();
  reg.draw.recent();
});
$('dash-clear').addEventListener('click', () => {
  filters = { ...BLANK, period: filters.period };
  saveFilters();
  fillFilters();
  redraw();
});
$('dash-choose').addEventListener('click', () => setEditing(true));
$('dash-done').addEventListener('click', () => setEditing(false));
$('dash-reset').addEventListener('click', () => {
  layout = defaultLayout();
  writeLayout(storage, layout);
  applyLayout();
  drawEditBars();
});

/* ---------- start ---------- */

function start() {
  reg = window.register;
  reg.redrawDashboard = redraw;
  reg.recentSince = () => periodStart(filters.period);
  applyLayout();
  fillFilters();
  redraw();
  reg.draw.recent();
}

function onAssets() {
  if (!reg) start();
  loadExtras();
  fillFilters();
  redraw();
}

/* A module runs after the classic scripts, so the register may already be
   up by the time this does. */
if (window.register) start(); else window.addEventListener('register-ready', start, { once: true });
if (window.register && window.register.assets) onAssets();
window.addEventListener('assets-loaded', onAssets);
