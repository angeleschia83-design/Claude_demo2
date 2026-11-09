(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat('en');
  const KINDS = ['Laptop only', 'iPad only', 'Both'];
  const DEV_CLASS = { 'Laptop only': 'laptop', 'iPad only': 'ipad', Both: 'both' };
  const TYPES = [['Sales', 'Sales'], ['HO', 'HO'], ['Unknown', 'No type']];

  /* Every column, in the order the table shows them. Device and Units are
     worked out from the serials rather than typed. */
  const FIELDS = [
    { key: 'name', label: 'Holder', kind: 'text', cls: 'who' },
    { key: 'type', label: 'Type', kind: 'choice' },
    { key: 'resigned', label: 'Resigned', kind: 'flag' },
    { key: 'status', label: 'Device', kind: 'derived' },
    { key: 'n', label: 'Units', kind: 'derived', cls: 'c-units num' },
    { key: 'position', label: 'Position', kind: 'text', cls: 'c-pos' },
    { key: 'department', label: 'Department', kind: 'text', cls: 'c-dept' },
    { key: 'unit', label: 'Unit', kind: 'text', cls: 'c-unit' },
    { key: 'lap', label: 'Laptop serial', kind: 'text', cls: 'c-lap mono' },
    { key: 'lapM', label: 'Laptop model', kind: 'text', cls: 'c-lapm' },
    { key: 'ipd', label: 'iPad serial', kind: 'text', cls: 'c-ipd mono' },
    { key: 'ipdM', label: 'iPad model', kind: 'text', cls: 'c-ipdm' },
    { key: 'rem', label: 'Remark', kind: 'text', cls: 'c-rem rem' },
    { key: 'note', label: 'Note', kind: 'text', cls: 'c-note' },
  ];
  const NUMERIC = new Set(['n', 'nL', 'nI']);
  const TYPE_CLASS = { Sales: 'sales', HO: 'ho', Unknown: 'unknown' };
  const GROUPS = [['Sales', 'Sales'], ['HO', 'Head office'], ['Unknown', 'No type set']];

  let session = { role: null };
  let HOLDERS = [];
  let FLEET = [];
  let SUMMARY = { rows: [], total: 0, duplicates: [] };
  let LOG = { entries: [], total: 0 };
  let PROBLEMS = null;
  const view = { q: '', type: '', dev: '', res: '', col: 'name', dir: 1 };

  const canEdit = () => session.role === 'admin' || session.role === 'editor';

  /* An invite link has to name an address a colleague's machine can reach.
     The admin is usually browsing on localhost, which on their machine means
     this computer and on anyone else's means their own, so prefer the
     network address the server reports. */
  const linkBase = () => {
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    const [first] = session.addresses || [];
    return local && first ? first : location.origin;
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      ...options,
    });
    if (res.status === 401 || res.status === 403) {
      const body = await res.json().catch(() => ({}));
      const error = new Error(body.error || 'Not allowed.');
      error.status = res.status;
      throw error;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      /* Some refusals are the register stopping to ask rather than a
         failure — an assignment that needs a ticket number, for one — so
         what came back travels with the error. */
      const error = new Error(body.error || 'The server said no.');
      error.status = res.status;
      error.body = body;
      throw error;
    }
    return res.status === 204 ? null : res.json();
  }

  const say = (msg, state) => {
    const el = $('saveline');
    el.textContent = msg;
    if (state) el.dataset.state = state; else el.removeAttribute('data-state');
  };

  /* ---------- filtering and sorting ---------- */

  const matches = (r) => {
    if (view.type && r.type !== view.type) return false;
    if (view.dev && r.status !== view.dev) return false;
    if (view.res && !r.resigned) return false;
    const terms = view.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = FIELDS.map((f) => r[f.key]).concat([r.src, r.hr_status]).join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  };

  const sorted = (rows) => rows.slice().sort((a, b) => {
    let d;
    if (NUMERIC.has(view.col)) d = Number(a[view.col] || 0) - Number(b[view.col] || 0);
    else if (view.col === 'resigned') d = (a.resigned ? 1 : 0) - (b.resigned ? 1 : 0);
    else d = String(a[view.col] || '').localeCompare(String(b[view.col] || ''), undefined,
      { numeric: true, sensitivity: 'base' });
    return (d * view.dir) || String(a.name).localeCompare(String(b.name));
  });

  /* ---------- drawing ---------- */

  function tiles() {
    const res = HOLDERS.filter((r) => r.resigned);
    const unset = HOLDERS.filter((r) => r.type === 'Unknown').length;
    $('t-people').textContent = nf.format(HOLDERS.length);
    $('t-people-s').textContent = unset ? `${nf.format(unset)} still have no type` : 'every one has a type';
    $('t-lap').textContent = nf.format(HOLDERS.reduce((a, r) => a + r.nL, 0));
    $('t-lap-s').textContent = `held by ${nf.format(HOLDERS.filter((r) => r.nL > 0).length)} people`;
    $('t-ipd').textContent = nf.format(HOLDERS.reduce((a, r) => a + r.nI, 0));
    $('t-ipd-s').textContent = `held by ${nf.format(HOLDERS.filter((r) => r.nI > 0).length)} people`;
    $('t-both').textContent = nf.format(HOLDERS.filter((r) => r.status === 'Both').length);
    $('t-res').textContent = nf.format(res.length);
    const owed = res.reduce((a, r) => a + r.n, 0);
    $('t-res-s').textContent = res.length
      ? `${nf.format(owed)} ${owed === 1 ? 'unit' : 'units'} to retrieve`
      : 'nobody tagged yet';
  }

  function mix() {
    const box = $('mix');
    box.replaceChildren();
    for (const [key, label] of GROUPS) {
      const group = HOLDERS.filter((r) => r.type === key);
      const row = document.createElement('div');
      row.className = 'bar-row';

      const lab = document.createElement('div');
      lab.className = 'bar-label';
      const name = document.createElement('span');
      name.className = 'n';
      name.textContent = label;
      const meta = document.createElement('span');
      meta.className = 'm';
      meta.textContent = `${nf.format(group.length)} people · ${nf.format(group.reduce((a, r) => a + r.n, 0))} units`;
      lab.append(name, meta);

      const bar = document.createElement('div');
      bar.className = 'bar';
      for (const kind of KINDS) {
        const v = group.filter((r) => r.status === kind).length;
        if (!v) continue;
        const seg = document.createElement('div');
        seg.className = `seg seg-${DEV_CLASS[kind]}`;
        seg.style.flex = `${v} 1 0`;
        seg.textContent = v;
        seg.title = `${kind}: ${nf.format(v)} of ${nf.format(group.length)}`;
        bar.appendChild(seg);
      }
      row.append(lab, bar);
      box.appendChild(row);
    }
  }

  function fleet() {
    const box = $('fleet');
    box.replaceChildren();
    const top = FLEET.slice(0, 10);
    const max = top.length ? top[0].n : 1;
    for (const m of top) {
      const row = document.createElement('div');
      row.className = 'fleet-row';
      row.title = `${m.model} — ${nf.format(m.n)} assigned`;
      const name = document.createElement('div');
      name.className = 'm';
      name.textContent = m.model;
      const track = document.createElement('div');
      track.className = 'fleet-track';
      const fill = document.createElement('div');
      fill.className = 'fleet-fill';
      fill.style.width = `${Math.max(2, (m.n / max) * 100)}%`;
      fill.style.background = m.kind === 'iPad' ? 'var(--ipad)' : 'var(--laptop)';
      track.appendChild(fill);
      const count = document.createElement('div');
      count.className = 'c';
      count.textContent = nf.format(m.n);
      row.append(name, track, count);
      box.appendChild(row);
    }
  }

  const cellText = (r, key) => {
    const value = r[key];
    return value === 0 ? '0' : (value == null ? '' : String(value));
  };

  /* Sends one field, shows the row as busy, and puts the control back if the
     server refuses, so the page never shows a change that was not saved. */
  async function patch(tr, r, body, revert) {
    tr.classList.add('is-saving');
    try {
      const updated = await api(`/api/holders/${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const i = HOLDERS.findIndex((row) => row.id === r.id);
      if (i >= 0) HOLDERS[i] = updated;
      say('Saved.', 'good');
      tiles();
      mix();
      tr.replaceWith(buildRow(updated));
    } catch (e) {
      if (revert) revert();
      say(e.status === 403 ? 'Your link lets you look, not change.' : `Not saved: ${e.message}`, 'bad');
      tr.classList.remove('is-saving');
    }
  }

  /* A cell turns into an input on click and saves when it loses focus or
     Enter is pressed. Escape puts it back. Rendering plain text the rest of
     the time keeps hundreds of rows light. */
  function editable(tr, r, field) {
    const td = document.createElement('td');
    td.className = ['ed', field.cls || ''].join(' ').trim();
    const paint = () => {
      td.replaceChildren(document.createTextNode(cellText(r, field.key)));
      if ((r.changed || []).includes(field.key)) {
        td.classList.add('is-changed');
        td.title = `Workbook says: ${r.base[field.key] || '(empty)'}`;
        const undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'undo';
        undo.textContent = '\u21ba';
        undo.title = 'Put back what the workbook says';
        undo.setAttribute('aria-label', `Undo the change to ${field.label} for ${r.name}`);
        undo.addEventListener('click', (event) => {
          event.stopPropagation();
          patch(tr, r, { [field.key]: null });
        });
        td.appendChild(undo);
      }
    };
    paint();
    if (!canEdit()) { tr.appendChild(td); return td; }

    td.tabIndex = 0;
    const open = () => {
      if (td.querySelector('input')) return;
      const input = document.createElement('input');
      input.className = 'edin';
      input.value = cellText(r, field.key);
      input.maxLength = 500;
      input.setAttribute('aria-label', `${field.label} for ${r.name}`);
      let done = false;
      const close = (commit) => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        const was = cellText(r, field.key);
        paint();
        if (commit && next !== was) patch(tr, r, { [field.key]: next });
      };
      input.addEventListener('blur', () => close(true));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); close(true); td.focus(); }
        if (event.key === 'Escape') { event.preventDefault(); close(false); td.focus(); }
      });
      td.replaceChildren(input);
      input.focus();
      input.select();
    };
    td.addEventListener('click', open);
    td.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); open(); }
    });
    tr.appendChild(td);
    return td;
  }

  function buildRow(r) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    if (r.resigned) tr.classList.add('is-resigned');

    for (const field of FIELDS) {
      if (field.kind === 'text') { editable(tr, r, field); continue; }

      const td = document.createElement('td');
      if (field.cls) td.className = field.cls;

      if (field.kind === 'derived') {
        if (field.key === 'status') {
          const pill = document.createElement('span');
          pill.className = `pill pill-${DEV_CLASS[r.status] || 'unknown'}`;
          pill.textContent = r.status;
          td.appendChild(pill);
        } else {
          td.textContent = cellText(r, field.key);
        }
      } else if (field.kind === 'choice') {
        if (canEdit()) {
          const sel = document.createElement('select');
          sel.className = 'sel';
          sel.setAttribute('aria-label', `${field.label} for ${r.name}`);
          for (const [value, text] of TYPES) sel.appendChild(new Option(text, value));
          sel.value = r.type;
          sel.dataset.unset = r.type === 'Unknown' ? 'y' : 'n';
          sel.addEventListener('change', () => patch(tr, r, { type: sel.value }));
          td.appendChild(sel);
        } else {
          const pill = document.createElement('span');
          pill.className = `pill pill-${TYPE_CLASS[r.type]}`;
          pill.textContent = r.type === 'Unknown' ? 'No type' : r.type;
          td.appendChild(pill);
        }
      } else if (field.kind === 'flag') {
        if (canEdit()) {
          const label = document.createElement('label');
          label.className = 'tick';
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = r.resigned;
          box.setAttribute('aria-label', `Mark ${r.name} resigned`);
          box.addEventListener('change', () => patch(tr, r, { resigned: box.checked }));
          const text = document.createElement('span');
          text.textContent = 'Resigned';
          label.append(box, text);
          td.appendChild(label);
        } else if (r.resigned) {
          const pill = document.createElement('span');
          pill.className = 'pill';
          pill.textContent = 'Resigned';
          td.appendChild(pill);
        }
        if (r.lwd) {
          const when = document.createElement('div');
          when.className = 'edited';
          when.textContent = `left ${r.lwd}`;
          td.appendChild(when);
        }
      }
      if ((r.changed || []).includes(field.key)) td.classList.add('is-changed');
      tr.appendChild(td);
    }
    return tr;
  }

  function table() {
    const list = sorted(HOLDERS.filter(matches));
    const body = $('rows');
    const frag = document.createDocumentFragment();
    if (!list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = FIELDS.length;
      td.className = 'empty';
      /* Searching for somebody who is not here is exactly the moment you
         want to add them, so the offer is made where the looking happened. */
      const typed = view.q.trim();
      if (typed && canEdit()) {
        td.textContent = `Nobody here matches \u201c${typed}\u201d. `;
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'rowbtn';
        add.textContent = `Add ${typed} as a new person`;
        add.addEventListener('click', () => openPerson(typed));
        td.appendChild(add);
      } else {
        td.textContent = 'Nobody matches these filters.';
      }
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    for (const r of list) frag.appendChild(buildRow(r));
    body.replaceChildren(frag);

    const bits = [];
    if (view.type) bits.push(view.type === 'Unknown' ? 'with no type' : view.type);
    if (view.dev) bits.push(view.dev.toLowerCase());
    if (view.res) bits.push('resigned');
    if (view.q.trim()) bits.push(`matching \u201c${view.q.trim()}\u201d`);
    $('count').textContent = `Showing ${nf.format(list.length)} of ${nf.format(HOLDERS.length)} holders`
      + (bits.length ? ` \u2014 ${bits.join(', ')}` : '') + '.';
  }

  /* The header is built from FIELDS too, so a column cannot drift from the
     data beneath it. */
  function buildHead() {
    const row = $('head');
    row.replaceChildren();
    for (const field of FIELDS) {
      const th = document.createElement('th');
      if (field.cls) th.className = field.cls.replace(/\b(who|num|mono|rem)\b/g, '').trim();
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = field.label;
      button.addEventListener('click', () => {
        view.dir = view.col === field.key ? -view.dir : 1;
        view.col = field.key;
        for (const other of row.querySelectorAll('th')) other.removeAttribute('aria-sort');
        th.setAttribute('aria-sort', view.dir === 1 ? 'ascending' : 'descending');
        table();
      });
      th.appendChild(button);
      if (field.key === view.col) th.setAttribute('aria-sort', 'ascending');
      row.appendChild(th);
    }
  }

  const draw = () => { tiles(); mix(); fleet(); table(); summary(); };

  /* ---------- asset summary ---------- */

  /* Rows come back grouped by type, status, model and age. Everything below
     is a pivot of those rows, so a value nobody has seen before simply turns
     up as another heading. */
  const pivot = (rows, down, across) => {
    const downs = [...new Set(rows.map((r) => r[down]))].sort();
    const acrosses = [...new Set(rows.map((r) => r[across]))].sort();
    const cells = new Map();
    for (const r of rows) {
      const key = `${r[down]}\u0000${r[across]}`;
      cells.set(key, (cells.get(key) || 0) + r.n);
    }
    return { downs, acrosses, at: (d, a) => cells.get(`${d}\u0000${a}`) || 0 };
  };

  function drawPivot(headId, bodyId, rows, down, across, firstLabel) {
    const { downs, acrosses, at } = pivot(rows, down, across);
    const head = $(headId);
    head.replaceChildren();
    for (const label of [firstLabel, ...acrosses, 'Total']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    }
    const body = $(bodyId);
    body.replaceChildren();
    const colTotals = new Map();
    let grand = 0;
    for (const d of downs) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = d;
      tr.appendChild(name);
      let rowTotal = 0;
      for (const a of acrosses) {
        const v = at(d, a);
        rowTotal += v;
        colTotals.set(a, (colTotals.get(a) || 0) + v);
        const td = document.createElement('td');
        td.className = 'num';
        td.textContent = v ? nf.format(v) : '';
        tr.appendChild(td);
      }
      grand += rowTotal;
      const total = document.createElement('td');
      total.className = 'num';
      total.textContent = nf.format(rowTotal);
      total.style.fontWeight = '500';
      tr.appendChild(total);
      body.appendChild(tr);
    }
    const foot = document.createElement('tr');
    const label = document.createElement('td');
    label.textContent = 'Total';
    label.style.fontWeight = '500';
    foot.appendChild(label);
    for (const a of acrosses) {
      const td = document.createElement('td');
      td.className = 'num';
      td.style.fontWeight = '500';
      td.textContent = nf.format(colTotals.get(a) || 0);
      foot.appendChild(td);
    }
    const grandCell = document.createElement('td');
    grandCell.className = 'num';
    grandCell.style.fontWeight = '600';
    grandCell.textContent = nf.format(grand);
    foot.appendChild(grandCell);
    body.appendChild(foot);
    return grand;
  }

  function summary() {
    const rows = SUMMARY.rows;
    if (!rows.length) return;
    const counted = drawPivot('sum-type-head', 'sum-type-body', rows, 'type', 'status', 'Asset type');
    $('sum-line').textContent = counted === SUMMARY.total
      ? `All ${nf.format(SUMMARY.total)} assets in the inventory are counted below.`
      : `${nf.format(counted)} counted of ${nf.format(SUMMARY.total)} assets \u2014 tell Claude, this should never happen.`;

    const pick = $('sum-pick');
    const types = [...new Set(rows.map((r) => r.type))].sort();
    if (pick.options.length !== types.length) {
      pick.replaceChildren(...types.map((t) => new Option(t, t)));
      pick.value = types.includes('Laptop') ? 'Laptop' : types[0];
    }
    const chosen = rows.filter((r) => r.type === pick.value);
    drawPivot('sum-model-head', 'sum-model-body', chosen, 'model', 'status', `${pick.value} model`);
    drawPivot('sum-age-head', 'sum-age-body', chosen, 'status', 'age', 'Status');
  }

  $('sum-pick').addEventListener('change', summary);

  /* ---------- worth putting right ---------- */

  function problemBlock(title, note, lines) {
    const card = document.createElement('div');
    const h = document.createElement('h2');
    h.textContent = `${title} (${nf.format(lines.length)})`;
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = note;
    const list = document.createElement('div');
    list.className = 'log';
    for (const line of lines.slice(0, 40)) {
      const row = document.createElement('div');
      row.textContent = line;
      list.appendChild(row);
    }
    if (lines.length > 40) {
      const more = document.createElement('div');
      more.textContent = `\u2026 and ${nf.format(lines.length - 40)} more. The export has them all.`;
      list.appendChild(more);
    }
    card.append(h, p, list);
    return card;
  }

  function problems() {
    if (!PROBLEMS) return;
    const box = $('problems');
    box.replaceChildren();
    const blocks = [];
    if (PROBLEMS.duplicatePeople && PROBLEMS.duplicatePeople.length) {
      blocks.push(duplicateBlock(PROBLEMS.duplicatePeople));
    }

    if (PROBLEMS.duplicates.length) {
      blocks.push(problemBlock(
        'Serial numbers listed twice',
        'One serial is one piece of hardware, so each is counted once here, taking the assigned record '
        + 'over the spare one. Worth correcting in the workbook so the two agree.',
        PROBLEMS.duplicates.map((d) =>
          `${d.serial} \u2014 ${d.asset_type}, listed as ${d.statuses.join(' and ')}`
          + (d.holder ? `, assigned to ${d.holder}` : ''))));
    }
    if (PROBLEMS.noStatus.length) {
      blocks.push(problemBlock('Assets with no status', 'Nothing says whether these are in use, spare or retired.',
        PROBLEMS.noStatus.map((d) => `${d.serial} \u2014 ${d.asset_type || 'no asset type'}`
          + (d.holder ? `, with ${d.holder}` : ''))));
    }
    if (PROBLEMS.noModel.length) {
      blocks.push(problemBlock('Laptops and iPads with no model', 'They are counted, but under "No model recorded".',
        PROBLEMS.noModel.map((d) => `${d.serial} \u2014 ${d.asset_type}`
          + (d.holder ? `, with ${d.holder}` : ''))));
    }
    if (PROBLEMS.oddStatus.length) {
      blocks.push(problemBlock('Statuses used once or twice',
        'Usually a typo or a different capitalisation of a status that already exists.',
        PROBLEMS.oddStatus.map((d) => `"${d.status}" \u2014 ${d.n} asset${d.n === 1 ? '' : 's'}`)));
    }
    if (PROBLEMS.noType.length) {
      blocks.push(problemBlock('Holders with no type',
        'No job title was found for them, so they are neither Sales nor HO. Set one in the register above.',
        PROBLEMS.noType.map((h) => `${h.name} \u2014 ${h.n} device${h.n === 1 ? '' : 's'}`)));
    }
    if (PROBLEMS.offRegister.length) {
      blocks.push(problemBlock('Holders on neither HR sheet',
        'They hold hardware but HR lists them as neither active nor resigned. Some are contractors or '
        + 'shared machines rather than people.',
        PROBLEMS.offRegister.map((h) => `${h.name} \u2014 ${h.n} device${h.n === 1 ? '' : 's'}`
          + (h.department ? `, ${h.department}` : ''))));
    }
    if (PROBLEMS.assignedToNobody && PROBLEMS.assignedToNobody.length) {
      blocks.push(problemBlock('Marked assigned, with nobody named',
        'The status says somebody has it and no name is recorded. Hand it out from the Assets section '
        + 'to say who, or put it back in stock.',
        PROBLEMS.assignedToNobody.slice(0, 200).map((d) =>
          `${d.serial} — ${[d.asset_type, d.model].filter(Boolean).join(' ')}`)));
    }
    if (PROBLEMS.noAge) {
      blocks.push(problemBlock('Assets with no age recorded',
        'They appear under "No age recorded" rather than being left out of the age tables.',
        [`${nf.format(PROBLEMS.noAge)} assets have no age in the workbook`]));
    }

    for (const block of blocks) box.appendChild(block);
    $('problems-card').hidden = blocks.length === 0;
  }

  /* ---------- changes handed back from the offline copy ---------- */

  let PLAN = null;

  const mergeSay = (text, state) => {
    const el = $('merge-line');
    el.textContent = text;
    if (state) el.dataset.state = state; else el.removeAttribute('data-state');
  };

  const WHY = {
    change: '',
    clash: 'Someone here changed this too — tick it only if theirs is the right one.',
    same: 'Already says this.',
    missing: 'No holder of that name in the register.',
  };

  function drawPlan(plan) {
    PLAN = plan;
    const body = $('merge-body');
    body.replaceChildren();

    for (const row of plan.rows) {
      const tr = document.createElement('tr');
      tr.dataset.state = row.state;

      const pick = document.createElement('td');
      if (row.state === 'change' || row.state === 'clash') {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = row.state === 'change';
        box.dataset.key = row.key;
        box.setAttribute('aria-label', `Apply ${row.label} for ${row.holder}`);
        pick.appendChild(box);
      }
      tr.appendChild(pick);

      const now = row.state === 'missing' && !row.was ? '\u2014' : (row.was || '(empty)');
      for (const text of [row.holder, row.label, now, row.becomes || '(cleared)']) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }

      const why = document.createElement('td');
      why.className = 'why';
      why.dataset.state = row.state;
      why.textContent = row.why || WHY[row.state] || '';
      tr.appendChild(why);

      body.appendChild(tr);
    }

    const { change, clash, same, missing } = plan.totals;
    const bits = [];
    if (change) bits.push(`${change} to apply`);
    if (clash) bits.push(`${clash} where this register was changed too`);
    if (same) bits.push(`${same} already done`);
    if (missing) bits.push(`${missing} naming nobody here`);
    const who = plan.from ? `From ${plan.from}` : 'From an offline copy';
    const when = plan.asOf ? `, working from the copy dated ${plan.asOf}` : '';
    mergeSay(bits.length ? `${who}${when}: ${bits.join(', ')}.` : `${who}${when}: nothing to change.`);

    $('merge-result').hidden = plan.rows.length === 0;
    $('merge-all').checked = change > 0 && clash === 0;
    $('merge-apply').disabled = change + clash === 0;
  }

  const picked = () => [...document.querySelectorAll('#merge-body input[type="checkbox"]:checked')]
    .map((box) => box.dataset.key);

  async function mergeCheck() {
    const text = $('merge-text').value.trim();
    if (!text) { mergeSay('Paste what they sent you first.', 'bad'); return; }
    mergeSay('Reading it…');
    try {
      drawPlan(await api('/api/merge/preview', { method: 'POST', body: JSON.stringify({ text }) }));
    } catch (e) {
      $('merge-result').hidden = true;
      mergeSay(e.message, 'bad');
    }
  }

  $('merge-check').addEventListener('click', mergeCheck);
  $('merge-pick').addEventListener('click', () => $('merge-file').click());
  $('merge-file').addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    $('merge-text').value = await file.text();
    event.target.value = '';
    mergeCheck();
  });
  $('merge-clear').addEventListener('click', () => {
    $('merge-text').value = '';
    $('merge-result').hidden = true;
    PLAN = null;
    mergeSay('\u00a0');
  });
  $('merge-all').addEventListener('change', (event) => {
    for (const box of document.querySelectorAll('#merge-body input[type="checkbox"]')) {
      box.checked = event.target.checked;
    }
  });

  $('merge-apply').addEventListener('click', async () => {
    const keys = picked();
    if (!keys.length) { mergeSay('Nothing is ticked.', 'bad'); return; }
    $('merge-apply').disabled = true;
    mergeSay('Applying…');
    try {
      const out = await api('/api/merge/apply', {
        method: 'POST',
        body: JSON.stringify({ text: $('merge-text').value.trim(), picked: keys }),
      });
      HOLDERS = out.holders;
      FLEET = out.fleet;
      draw();
      $('merge-result').hidden = true;
      $('merge-text').value = '';
      PLAN = null;
      const across = [
        out.people ? `${out.people} ${out.people === 1 ? 'person' : 'people'}` : '',
        out.assets ? `${out.assets} asset${out.assets === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' and ');
      mergeSay(`Applied ${out.fields} change${out.fields === 1 ? '' : 's'}`
        + `${across ? ` across ${across}` : ''}`
        + `${out.from ? `, from ${out.from}` : ''}. Each one is in the change log.`, 'good');
      refreshLog();
      window.dispatchEvent(new CustomEvent('assets-changed'));
    } catch (e) {
      mergeSay(e.message, 'bad');
    } finally {
      $('merge-apply').disabled = false;
    }
  });

  /* ---------- one person entered twice ---------- */

  /* The workbook names people by whatever was typed into it, so the same
     person typed two ways is two holders with some hardware each. The
     register proposes the pairs; a person decides, because two people can
     genuinely have nearly the same name. */
  function duplicateBlock(pairs) {
    const card = document.createElement('div');
    card.className = 'dupes';
    const title = document.createElement('h2');
    title.textContent = `Possible duplicate people (${pairs.length})`;
    card.appendChild(title);

    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'One person entered twice holds some of their hardware under each name. '
      + 'Keeping one record moves the other\u2019s hardware onto it and folds it away — which an '
      + 'import cannot undo, unlike deleting. No hardware is ever removed: it all ends up on the '
      + 'record you keep.';
    card.appendChild(note);

    if (session.role === 'admin') {
      const all = document.createElement('div');
      all.className = 'pair-do';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-small';
      button.textContent = `Fold all ${pairs.length} ${pairs.length === 1 ? 'pair' : 'pairs'}`;
      const result = document.createElement('div');
      result.className = 'log';
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Folding\u2026';
        try {
          const out = await api('/api/holders/fold-all', { method: 'POST' });
          HOLDERS = out.holders;
          FLEET = out.fleet;
          draw();
          result.replaceChildren();
          for (const row of out.report) {
            const line = document.createElement('div');
            line.textContent = row.error
              ? `${row.folded} could not be folded: ${row.error}`
              : `${row.folded} \u2192 ${row.kept} \u2014 ${row.moved} asset${row.moved === 1 ? '' : 's'} `
                + `moved, ${row.kept} now holds ${row.now}. ${row.why}`;
            result.appendChild(line);
          }
          say(`${out.folded} ${out.folded === 1 ? 'pair' : 'pairs'} folded. No hardware moved out of `
            + 'the register — it is all on the records that were kept. Any one of them can be put '
            + 'back from the sharing section.', 'good');
          refreshLog();
          window.dispatchEvent(new CustomEvent('assets-changed'));
          loadFolded();
          PROBLEMS = await api('/api/problems');
          problems();
          $('problems').appendChild(result);
        } catch (error) {
          say(error.message, 'bad');
          button.disabled = false;
          button.textContent = `Fold all ${pairs.length} pairs`;
        }
      });
      all.appendChild(button);
      const why = document.createElement('span');
      why.className = 'muted';
      why.textContent = 'Each pair keeps the record HR\u2019s own list spells that way, and says so.';
      all.appendChild(why);
      card.append(all);
      card.appendChild(result);
    }

    for (const pair of pairs.slice(0, 40)) {
      const box = document.createElement('div');
      box.className = 'pair';

      for (const person of pair.people) {
        const line = document.createElement('p');
        line.className = 'pair-who';
        const name = document.createElement('strong');
        name.textContent = person.name;
        line.appendChild(name);
        const rest = [
          person.type === 'Unknown' ? 'no type' : person.type,
          person.position || person.department || '',
          `${person.n} device${person.n === 1 ? '' : 's'}`,
          person.createdHere ? 'added here' : '',
        ].filter(Boolean).join(' \u00b7 ');
        line.appendChild(document.createTextNode(` \u2014 ${rest}`));
        if (person.lap || person.ipd) {
          const serials = document.createElement('span');
          serials.className = 'pair-ser';
          serials.textContent = [person.lap, person.ipd].filter(Boolean).join('; ');
          line.appendChild(serials);
        }
        box.appendChild(line);
      }

      const why = document.createElement('p');
      why.className = 'pair-why';
      why.textContent = pair.why;
      box.appendChild(why);

      const row = document.createElement('div');
      row.className = 'pair-do';
      const act = (label, run) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rowbtn';
        button.textContent = label;
        button.addEventListener('click', async () => {
          for (const other of row.querySelectorAll('button')) other.disabled = true;
          try { await run(); } catch (error) {
            why.textContent = error.message;
            for (const other of row.querySelectorAll('button')) other.disabled = false;
          }
        });
        row.appendChild(button);
      };

      const [first, second] = pair.people;
      act(`Keep ${first.name}`, () => fold(second.id, first.id));
      act(`Keep ${second.name}`, () => fold(first.id, second.id));
      act('Not the same person', async () => {
        await api('/api/not-duplicates', { method: 'POST', body: JSON.stringify({ key: pair.key }) });
        PROBLEMS.duplicatePeople = PROBLEMS.duplicatePeople.filter((other) => other.key !== pair.key);
        problems();
      });
      box.appendChild(row);
      card.appendChild(box);
    }
    return card;
  }

  async function fold(loserId, keeperId) {
    const out = await api(`/api/holders/${encodeURIComponent(loserId)}/merge`, {
      method: 'POST',
      body: JSON.stringify({ into: keeperId }),
    });
    HOLDERS = out.holders;
    FLEET = out.fleet;
    draw();
    say(`${out.folded} folded into ${out.keeper.name}`
      + `${out.moved ? `, and ${out.moved} asset${out.moved === 1 ? '' : 's'} moved across` : ''}. `
      + 'An admin can put it back from the sharing section.', 'good');
    refreshLog();
    window.dispatchEvent(new CustomEvent('assets-changed'));
    if (session.role === 'admin') { loadFolded(); loadAdded(); }
    PROBLEMS = await api('/api/problems');
    problems();
  }

  /* ---------- change log ---------- */

  function logView() {
    const q = $('log-q').value.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const match = (e) => terms.every((t) => [e.actor, e.name, e.serial, e.holder_id, e.ticket,
      e.field, e.old_value, e.new_value].join(' ').toLowerCase().includes(t));
    const list = LOG.entries.filter(match);

    const body = $('log-body');
    body.replaceChildren();
    if (!list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'empty';
      td.textContent = LOG.entries.length ? 'Nothing in the log matches that.' : 'Nothing has been changed yet.';
      tr.appendChild(td);
      body.appendChild(tr);
    }
    for (const e of list.slice(0, 1000)) {
      const tr = document.createElement('tr');
      for (const text of [
        new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
        e.actor,
        e.name || e.serial || e.holder_id,
        (FIELDS.find((f) => f.key === e.field) || { label: e.field }).label,
        e.old_value || '(empty)',
        e.new_value || '(empty)',
        e.ticket || '',
      ]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    $('log-count').textContent = terms.length
      ? `Showing ${nf.format(list.length)} of ${nf.format(LOG.entries.length)} changes.`
      : `${nf.format(LOG.entries.length)} change${LOG.entries.length === 1 ? '' : 's'}`
        + (LOG.total > LOG.entries.length ? ` of ${nf.format(LOG.total)} in all, newest first.` : ', newest first.');
    $('log-note').textContent = 'Every correction anyone makes, with who made it. '
      + 'A link shows up under the name you gave it.';
  }

  /* After a merge the log has new lines in it; this pulls them in without
     a reload, and quietly does nothing for a role that cannot see the log. */
  function refreshLog() {
    if (!canEdit()) return;
    api('/api/audit?limit=1000').then((log) => { LOG = log; logView(); }).catch(() => {});
    api('/api/problems').then((found) => { PROBLEMS = found; problems(); }).catch(() => {});
  }

  $('log-q').addEventListener('input', logView);
  $('log-export').addEventListener('click', () => { location.href = '/api/audit.csv'; });

  /* ---------- admin panel ---------- */

  function loadAdded() {
    const box = $('added');
    if (!box) return;
    const rows = HOLDERS.filter((row) => row.createdHere);
    box.replaceChildren();
    if (!rows.length) {
      const none = document.createElement('p');
      none.className = 'muted';
      none.textContent = 'Nobody has been added here.';
      box.appendChild(none);
      return;
    }
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'folded';
      const who = document.createElement('span');
      who.textContent = `${row.name} \u2014 ${row.n} device${row.n === 1 ? '' : 's'}`;
      line.appendChild(who);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rowbtn';
      button.textContent = 'Remove';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const out = await api(`/api/holders/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
          HOLDERS = out.holders;
          FLEET = out.fleet;
          draw();
          say(`${out.removed} removed.`, 'good');
          loadAdded();
          refreshLog();
        } catch (error) {
          say(error.message, 'bad');
          button.disabled = false;
        }
      });
      line.appendChild(button);
      box.appendChild(line);
    }
  }

  async function loadFolded() {
    const box = $('folded');
    if (!box) return;
    let rows = [];
    try { rows = await api('/api/merged'); } catch (error) { return; }
    box.replaceChildren();
    if (!rows.length) {
      const none = document.createElement('p');
      none.className = 'muted';
      none.textContent = 'Nothing has been folded.';
      box.appendChild(none);
      return;
    }
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'folded';
      const who = document.createElement('span');
      who.textContent = `${row.name} \u2192 ${row.into_name || row.merged_into}`;
      line.appendChild(who);
      const when = document.createElement('span');
      when.className = 'muted';
      when.textContent = row.updated_by ? `by ${row.updated_by}` : '';
      line.appendChild(when);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rowbtn';
      button.textContent = 'Put it back';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const out = await api(`/api/holders/${encodeURIComponent(row.id)}/unmerge`, { method: 'POST' });
          HOLDERS = out.holders;
          FLEET = out.fleet;
          draw();
          say(`${row.name} has its own record again. The hardware stayed with `
            + `${row.into_name || row.merged_into}.`, 'good');
          loadFolded();
          refreshLog();
        } catch (error) {
          say(error.message, 'bad');
          button.disabled = false;
        }
      });
      line.appendChild(button);
      box.appendChild(line);
    }
  }

  async function loadAdmin() {
    if (session.role !== 'admin') return;
    $('admin').hidden = false;
    loadAdded();
    loadFolded();

    const note = $('link-note');
    const [address] = session.addresses || [];
    if (address && linkBase() !== location.origin) {
      note.textContent = `Links below use ${address}, which is how other machines on your network reach this one.`
        + ' They must be on the same network, and this computer must stay on with the register running.';
    } else if (!address) {
      note.textContent = 'This computer has no network address right now, so links will only work on it.';
    } else {
      note.textContent = '';
    }

    const invites = await api('/api/invites');

    const links = $('links');
    links.replaceChildren();
    if (!invites.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No links yet.';
      links.appendChild(p);
    }
    for (const invite of invites) {
      const item = document.createElement('div');
      item.className = 'link-item' + (invite.revoked ? ' is-revoked' : '');
      const left = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = `${invite.label} — ${invite.role === 'editor' ? 'can correct' : 'can look'}`
        + (invite.revoked ? ' — withdrawn' : '');
      const url = document.createElement('code');
      url.textContent = `${linkBase()}/i/${invite.token}`;
      left.append(title, url);
      const right = document.createElement('div');
      right.className = 'actions';
      if (!invite.revoked) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn btn-quiet btn-small';
        copy.textContent = 'Copy link';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(url.textContent);
            copy.textContent = 'Copied';
            setTimeout(() => { copy.textContent = 'Copy link'; }, 1500);
          } catch (e) {
            /* Browsers only allow copying on https or localhost. Reached by
               its network address the register is plain http, so select the
               link and tell the person to copy it themselves. */
            const range = document.createRange();
            range.selectNodeContents(url);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            copy.textContent = 'Press Ctrl+C';
            setTimeout(() => { copy.textContent = 'Copy link'; }, 4000);
          }
        });
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.className = 'btn btn-quiet btn-small';
        revoke.textContent = 'Withdraw';
        revoke.addEventListener('click', async () => {
          await api(`/api/invites/${encodeURIComponent(invite.token)}/revoke`, { method: 'POST' });
          loadAdmin();
        });
        right.append(copy, revoke);
      }
      item.append(left, right);
      links.appendChild(item);
    }

  }

  $('invite-make').addEventListener('click', async () => {
    const label = $('invite-label').value.trim();
    if (!label) { say('Give the link a name first, so you know who it went to.', 'bad'); return; }
    try {
      await api('/api/invites', {
        method: 'POST',
        body: JSON.stringify({ label, role: $('invite-role').value }),
      });
      $('invite-label').value = '';
      say('Link created.', 'good');
      loadAdmin();
    } catch (e) {
      say(`Could not create that link: ${e.message}`, 'bad');
    }
  });

  /* ---------- wiring ---------- */

  for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      view[chip.dataset.f] = chip.dataset.v;
      for (const other of document.querySelectorAll(`.chip[data-f="${chip.dataset.f}"]`)) {
        other.setAttribute('aria-pressed', String(other === chip));
      }
      table();
    });
  }
  $('q').addEventListener('input', () => { view.q = $('q').value; table(); });
  $('export').addEventListener('click', () => { location.href = '/api/export.csv'; });
  $('export-xlsx').addEventListener('click', () => { location.href = '/api/export.xlsx'; });
  $('logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('gate-msg');
    msg.removeAttribute('data-state');
    msg.textContent = 'Checking…';
    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: $('password').value }),
      });
      location.reload();
    } catch (err) {
      msg.dataset.state = 'bad';
      msg.textContent = err.message;
    }
  });

  /* ---------- start ---------- */

  (async () => {
    session = await api('/api/session').catch(() => ({ role: null }));
    if (!session.role) { $('gate').hidden = false; return; }
    $('app').hidden = false;
    buildHead();
    if (session.version) $('version').textContent = `v${session.version}`;
    $('whoami').textContent = session.role === 'admin'
      ? 'Signed in as IT admin'
      : `${session.label} — ${session.role === 'editor' ? 'you can make corrections' : 'you can look only'}`;
    if (!canEdit()) say('Your link lets you look, not change.');
    try {
      const [data, sum] = await Promise.all([api('/api/holders'), api('/api/summary')]);
      HOLDERS = data.holders;
      FLEET = data.fleet;
      SUMMARY = sum;
      draw();
      loadAdmin();
      /* The log and the data-quality list are for people who can change
         things; a viewer link gets neither. */
      if (canEdit()) {
        $('log-card').hidden = false;
        $('merge-card').hidden = false;
        Promise.all([api('/api/audit?limit=1000'), api('/api/problems')])
          .then(([log, found]) => { LOG = log; PROBLEMS = found; logView(); problems(); })
          .catch(() => { $('log-card').hidden = true; });
      }
    } catch (e) {
      $('rows').replaceChildren();
      $('count').textContent = `The register did not load: ${e.message}`;
    }

    /* The asset side is its own file. It needs the same session, the same
       way of talking to the server, and a way to say "the holders have
       moved, draw them again" after an assignment. */
    window.register = {
      api,
      session,
      say,
      refreshLog,
      reload: async () => {
        const data = await api('/api/holders');
        HOLDERS = data.holders;
        FLEET = data.fleet;
        draw();
        refreshLog();
      },
      holders: () => HOLDERS,
      canEdit,
    };
    window.dispatchEvent(new CustomEvent('register-ready'));
  })();
})();
