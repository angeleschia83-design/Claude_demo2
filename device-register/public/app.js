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

  /* ---------- the ticket number every audited change carries ---------- */

  /* The last one typed is offered again: a batch of hand-outs usually
     belongs to the one request. */
  let lastTicket = '';
  const rememberTicket = (value) => { if (value) lastTicket = value; return value; };
  let ticketDone = null;

  function finishTicket(value) {
    const done = ticketDone;
    ticketDone = null;
    if ($('ticket-dlg').open) $('ticket-dlg').close();
    if (done) done(value);
  }

  /** Asks for a ticket number before a change the change log must be able
      to trace. Resolves to the number, or null when somebody cancels. */
  function askTicket({ title = 'Ticket number', text = '', go = 'Save' } = {}) {
    if (ticketDone) finishTicket(null);
    $('ticket-title').textContent = title;
    $('ticket-text').textContent = text;
    $('ticket-go').textContent = go;
    $('ticket-in').value = lastTicket;
    const line = $('ticket-line');
    line.textContent = '\u00a0';
    line.removeAttribute('data-state');
    $('ticket-dlg').showModal();
    $('ticket-in').focus();
    $('ticket-in').select();
    return new Promise((resolve) => { ticketDone = resolve; });
  }

  $('ticket-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = $('ticket-in').value.trim();
    if (!value) {
      $('ticket-line').textContent = 'A ticket number is needed, so this can be looked up later.';
      $('ticket-line').dataset.state = 'bad';
      $('ticket-in').focus();
      return;
    }
    finishTicket(rememberTicket(value));
  });
  $('ticket-cancel').addEventListener('click', () => finishTicket(null));
  $('ticket-dlg').addEventListener('close', () => finishTicket(null));

  /* ---------- what is waiting to come back, read once for everyone ---------- */

  /* The resign pop-up, Needs attention, the dashboard and the tags on both
     tables all need the to-retrieve list and the resign status words. One
     request each, shared, rather than one per part of the page. */
  let EXTRAS = { retrieve: { status: null, rows: [] }, statuses: null };
  let WAITING = new Map();
  let extrasLoading = null;
  function loadExtras() {
    if (!extrasLoading) {
      extrasLoading = Promise.all([api('/api/retrieve'), api('/api/resign-statuses')])
        .then(([retrieve, statuses]) => {
          EXTRAS = { retrieve, statuses };
          WAITING = new Map(retrieve.rows.map((row) => [row.serial, row]));
          return EXTRAS;
        })
        .catch(() => EXTRAS)
        .finally(() => { extrasLoading = null; });
    }
    return extrasLoading;
  }

  const assetsNow = () => (window.register && window.register.assets ? window.register.assets() : null);

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

  function tiles(rows = HOLDERS) {
    const res = rows.filter((r) => r.resigned);
    const unset = rows.filter((r) => r.type === 'Unknown').length;
    $('t-people').textContent = nf.format(rows.length);
    $('t-people-s').textContent = unset ? `${nf.format(unset)} still have no type` : 'every one has a type';
    $('t-lap').textContent = nf.format(rows.reduce((a, r) => a + r.nL, 0));
    const people = (n) => `${nf.format(n)} ${n === 1 ? 'person' : 'people'}`;
    $('t-lap-s').textContent = `held by ${people(rows.filter((r) => r.nL > 0).length)}`;
    $('t-ipd').textContent = nf.format(rows.reduce((a, r) => a + r.nI, 0));
    $('t-ipd-s').textContent = `held by ${people(rows.filter((r) => r.nI > 0).length)}`;
    $('t-both').textContent = nf.format(rows.filter((r) => r.status === 'Both').length);
    $('t-res').textContent = nf.format(res.length);
    const owed = res.reduce((a, r) => a + r.n, 0);
    $('t-res-s').textContent = res.length
      ? `${nf.format(owed)} ${owed === 1 ? 'unit' : 'units'} to retrieve`
      : 'nobody tagged yet';
  }

  function mix(rows = HOLDERS) {
    const box = $('mix');
    box.replaceChildren();
    for (const [key, label] of GROUPS) {
      const group = rows.filter((r) => r.type === key);
      const row = document.createElement('div');
      row.className = 'bar-row';

      const lab = document.createElement('div');
      lab.className = 'bar-label';
      const name = document.createElement('span');
      name.className = 'n';
      name.textContent = label;
      const meta = document.createElement('span');
      meta.className = 'm';
      const units = group.reduce((a, r) => a + r.n, 0);
      meta.textContent = `${nf.format(group.length)} ${group.length === 1 ? 'person' : 'people'}, `
        + `${nf.format(units)} ${units === 1 ? 'unit' : 'units'}`;
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

  function fleet(rows = FLEET) {
    const box = $('fleet');
    box.replaceChildren();
    const top = rows.slice(0, 10);
    const max = top.length ? top[0].n : 1;
    for (const m of top) {
      const row = document.createElement('div');
      row.className = 'fleet-row';
      row.title = `${m.model}: ${nf.format(m.n)} assigned`;
      const name = document.createElement('div');
      name.className = 'm';
      name.textContent = m.model;
      const track = document.createElement('div');
      track.className = 'fleet-track';
      const fill = document.createElement('div');
      fill.className = 'fleet-fill';
      fill.style.width = `${Math.max(2, (m.n / max) * 100)}%`;
      fill.style.background = m.kind === 'iPad' ? 'var(--color-ipad)' : 'var(--color-laptop)';
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
      if (window.register && window.register.redrawDashboard) window.register.redrawDashboard();
      else { tiles(); mix(); }
      tr.replaceWith(buildRow(updated));
      refreshLog();
    } catch (e) {
      if (revert) revert();
      say(e.status === 403 && !/resigned/i.test(e.message)
        ? 'Your link lets you look, not change.' : `Not saved: ${e.message}`, 'bad');
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
    if (!canEdit() || lockedFor(r)) {
      td.querySelector('.undo')?.remove();
      tr.appendChild(td);
      return td;
    }

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

  /* Somebody who has left is read-only except to an admin, so a
     record kept for the audit cannot drift after the fact. */
  const lockedFor = (r) => Boolean(r.resigned) && session.role !== 'admin';

  /* What a leaver still has to hand back, said on their row so nobody has
     to go to Needs attention to find out. */
  function leaverTag(r) {
    const assets = assetsNow();
    const tag = document.createElement('span');
    tag.className = 'tag';
    if (!assets) {
      tag.textContent = r.n ? `${r.n} on their name` : 'all back';
      if (r.n) tag.classList.add('tag-wait');
      return tag;
    }
    const held = assets.filter((a) => a.holder_id === r.id);
    const waiting = held.filter((a) => WAITING.has(a.serial)).length;
    const open = held.length - waiting;
    const bits = [];
    if (waiting) bits.push(`${waiting} to retrieve`);
    if (open) bits.push(`${open} not decided`);
    tag.textContent = bits.length ? bits.join(', ') : 'all back';
    if (bits.length) tag.classList.add('tag-wait');
    return tag;
  }

  function buildRow(r) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    if (r.resigned) tr.classList.add('is-resigned');
    const locked = lockedFor(r);
    if (locked && canEdit()) tr.classList.add('is-locked');
    /* Who touched this record last, without having to go and look it up. */
    if (r.updated_by) {
      tr.title = `Last changed by ${r.updated_by}`
        + (r.updated_at
          ? ` on ${new Date(r.updated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
          : '');
    }
    if (locked && canEdit()) {
      tr.title = `${tr.title ? `${tr.title}. ` : ''}Resigned: only an admin can change this record.`;
    }

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
        if (canEdit() && !locked) {
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
          box.disabled = locked;
          box.setAttribute('aria-label', locked
            ? `${r.name} is resigned; only an admin can change that`
            : `Mark ${r.name} resigned`);
          box.addEventListener('change', async () => {
            /* Ticking always opens the pop-up, for somebody holding nothing
               too: it asks what happens to any hardware, and it asks for the
               ticket. The box stays unticked until that is saved. */
            const reg = window.register;
            if (box.checked) {
              box.checked = false;
              if (reg && reg.openResign) reg.openResign(r);
              return;
            }
            /* Unticking, which only an admin can reach on a resigned row. */
            box.checked = true;
            const ticket = await askTicket({
              title: `${r.name} is not resigned after all`,
              text: 'They go back to being current staff. Hardware tagged To retrieve keeps that status '
                + 'until somebody changes it.',
              go: 'Untick resigned',
            });
            if (!ticket) return;
            box.checked = false;
            patch(tr, r, { resigned: false, ticket }, () => { box.checked = true; });
          });
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
        if (r.resigned) {
          const line = document.createElement('div');
          line.className = 'tagline';
          line.appendChild(leaverTag(r));
          td.appendChild(line);
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
      + (bits.length ? `: ${bits.join(', ')}` : '') + '.';
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

  /* The dashboard redraws its own cards, with whatever filters are set. */
  const draw = () => {
    if (window.register && window.register.redrawDashboard) window.register.redrawDashboard();
    else { tiles(); mix(); fleet(); }
    table();
    summary();
  };

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
      : `${nf.format(counted)} counted of ${nf.format(SUMMARY.total)} assets. Tell IT, this should never happen.`;

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
    /* Duplicates are about people, so they live on the People tab. */
    const pairs = PROBLEMS.duplicatePeople || [];
    $('dupes').replaceChildren(...(pairs.length ? [duplicateBlock(pairs)] : []));
    $('dupes-card').hidden = pairs.length === 0;

    if (PROBLEMS.duplicates.length) {
      blocks.push(problemBlock(
        'Serial numbers listed twice',
        'One serial is one piece of hardware, so each is counted once here, taking the assigned record '
        + 'over the spare one. Worth correcting in the workbook so the two agree.',
        PROBLEMS.duplicates.map((d) =>
          `${d.serial}: ${d.asset_type}, listed as ${d.statuses.join(' and ')}`
          + (d.holder ? `, assigned to ${d.holder}` : ''))));
    }
    if (PROBLEMS.noStatus.length) {
      blocks.push(problemBlock('Assets with no status', 'Nothing says whether these are in use, spare or retired.',
        PROBLEMS.noStatus.map((d) => `${d.serial}: ${d.asset_type || 'no asset type'}`
          + (d.holder ? `, with ${d.holder}` : ''))));
    }
    if (PROBLEMS.noModel.length) {
      blocks.push(problemBlock('Laptops and iPads with no model', 'They are counted, but under "No model recorded".',
        PROBLEMS.noModel.map((d) => `${d.serial}: ${d.asset_type}`
          + (d.holder ? `, with ${d.holder}` : ''))));
    }
    if (PROBLEMS.oddStatus.length) {
      blocks.push(problemBlock('Statuses used once or twice',
        'Usually a typo or a different capitalisation of a status that already exists.',
        PROBLEMS.oddStatus.map((d) => `\u201c${d.status}\u201d: ${d.n} asset${d.n === 1 ? '' : 's'}`)));
    }
    if (PROBLEMS.noType.length) {
      blocks.push(problemBlock('Holders with no type',
        'No job title was found for them, so they are neither Sales nor HO. Set one in the register above.',
        PROBLEMS.noType.map((h) => `${h.name}: ${h.n} device${h.n === 1 ? '' : 's'}`)));
    }
    if (PROBLEMS.offRegister.length) {
      blocks.push(problemBlock('Holders on neither HR sheet',
        'They hold hardware but HR lists them as neither active nor resigned. Some are contractors or '
        + 'shared machines rather than people.',
        PROBLEMS.offRegister.map((h) => `${h.name}: ${h.n} device${h.n === 1 ? '' : 's'}`
          + (h.department ? `, ${h.department}` : ''))));
    }
    if (PROBLEMS.assignedToNobody && PROBLEMS.assignedToNobody.length) {
      blocks.push(problemBlock('Marked assigned, with nobody named',
        'The status says somebody has it and no name is recorded. Hand it out from the Assets section '
        + 'to say who, or put it back in stock.',
        PROBLEMS.assignedToNobody.slice(0, 200).map((d) =>
          `${d.serial}: ${[d.asset_type, d.model].filter(Boolean).join(' ')}`)));
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

  const mergeSay = (text, state) => {
    const el = $('merge-line');
    el.textContent = text;
    if (state) el.dataset.state = state; else el.removeAttribute('data-state');
  };

  const WHY = {
    change: '',
    clash: 'Someone here changed this too: tick it only if theirs is the right one.',
    same: 'Already says this.',
    missing: 'No holder of that name in the register.',
  };

  function drawPlan(plan) {
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

      const now = row.state === 'missing' && !row.was ? '(none)' : (row.was || '(empty)');
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
    const ticket = await askTicket({
      title: `Apply ${keys.length} change${keys.length === 1 ? '' : 's'}`,
      text: 'The ticket goes on every change-log line this paste writes.',
      go: 'Apply',
    });
    if (!ticket) return;
    $('merge-apply').disabled = true;
    mergeSay('Applying…');
    try {
      const out = await api('/api/merge/apply', {
        method: 'POST',
        body: JSON.stringify({ text: $('merge-text').value.trim(), picked: keys, ticket }),
      });
      HOLDERS = out.holders;
      FLEET = out.fleet;
      draw();
      $('merge-result').hidden = true;
      $('merge-text').value = '';
      const across = [
        out.people ? `${out.people} ${out.people === 1 ? 'person' : 'people'}` : '',
        out.assets ? `${out.assets} asset${out.assets === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' and ');
      /* Rows the register refused — an unknown status or model, usually.
         These were dropped silently before, so the count simply came back
         lower than the number ticked and nothing said why. */
      const refused = out.rejected || [];
      mergeSay(`Applied ${out.fields} change${out.fields === 1 ? '' : 's'}`
        + `${across ? ` across ${across}` : ''}`
        + `${out.from ? `, from ${out.from}` : ''}. Each one is in the change log.`
        + (refused.length
          ? ` ${refused.length} not applied: ${refused.slice(0, 3)
            .map((r) => `${r.serial} (${r.why})`).join('; ')}`
            + `${refused.length > 3 ? `, and ${refused.length - 3} more` : ''}.`
          : ''), refused.length ? '' : 'good');
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
      + 'Keeping one record moves the other\u2019s hardware onto it and folds it away, which an '
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
              : `${row.folded} \u2192 ${row.kept}: ${row.moved} asset${row.moved === 1 ? '' : 's'} `
                + `moved, ${row.kept} now holds ${row.now}. ${row.why}`;
            result.appendChild(line);
          }
          say(`${out.folded} ${out.folded === 1 ? 'pair' : 'pairs'} folded. No hardware moved out of `
            + 'the register: it is all on the records that were kept. Any one of them can be put '
            + 'back under Settings, Records folded into another.', 'good');
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
        line.appendChild(document.createTextNode(`: ${rest}`));
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
      + 'An admin can put it back under Settings, Records folded into another.', 'good');
    refreshLog();
    window.dispatchEvent(new CustomEvent('assets-changed'));
    if (session.role === 'admin') { loadFolded(); loadAdded(); }
    PROBLEMS = await api('/api/problems');
    problems();
  }

  /* ---------- what has changed lately ---------- */

  /* The full log is further down and answers "what happened to this
     serial". This answers the question people actually open the page with:
     has anything moved since I last looked, and who moved it. */

  /* A log line names a field, and the same key means different things on a
     holder and on an asset: 'status' is the holder's Device column and the
     asset's Status. Anything that is already a phrase — "assigned to",
     "taken off the register" — passes through as written. */
  const ASSET_FIELD = new Map([
    ['asset_type', 'Asset type'], ['kind', 'Kind'], ['model', 'Model'], ['status', 'Status'],
    ['age_years', 'Age in years'], ['os', 'Operating system'], ['host_name', 'Host name'],
    ['specs', 'Specification'], ['remarks', 'Remark'], ['assigned_on', 'Assigned on'],
    ['invoice_date', 'Invoice date'], ['purchased_on', 'Purchase date'],
    ['serial', 'Serial'],
  ]);

  const fieldLabel = (entry) => (entry.serial
    ? ASSET_FIELD.get(entry.field) || entry.field
    : (FIELDS.find((f) => f.key === entry.field) || { label: entry.field }).label);

  const AGO = [
    [60, 'just now'], [3600, (n) => `${Math.floor(n / 60)} min ago`],
    [86400, (n) => `${Math.floor(n / 3600)} hr ago`],
    [172800, 'yesterday'],
  ];

  function ago(when) {
    const seconds = (Date.now() - new Date(when).getTime()) / 1000;
    if (!Number.isFinite(seconds)) return '';
    for (const [limit, label] of AGO) {
      if (seconds < limit) return typeof label === 'function' ? label(seconds) : label;
    }
    return new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  /* `after` is the dashboard's period: only changes made after it. */
  function recent(after = window.register && window.register.recentSince ? window.register.recentSince() : null) {
    const card = $('recent-card');
    if (!LOG || !LOG.entries || !canEdit()) { card.hidden = true; return; }
    card.hidden = false;
    const rows = LOG.entries.filter((e) => !after || new Date(e.at) >= after).slice(0, 8);
    const box = $('recent');
    box.replaceChildren();

    for (const entry of rows) {
      const line = document.createElement('div');
      line.className = 'recent-row';

      const when = document.createElement('span');
      when.className = 'recent-when';
      when.textContent = ago(entry.at);
      when.title = new Date(entry.at).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' });

      const who = document.createElement('span');
      who.className = 'recent-who';
      who.textContent = entry.actor;
      who.title = entry.actor;

      const what = document.createElement('span');
      what.className = 'recent-what';
      const subject = document.createElement('strong');
      subject.textContent = entry.name || entry.serial || entry.holder_id || '';
      /* A comma, not a dash, and none at all when the change is about the
         register itself (a word added to a list) rather than a row. */
      if (subject.textContent) what.append(subject, document.createTextNode(', '));
      what.appendChild(document.createTextNode(
        `${fieldLabel(entry)}: ${entry.old_value || '(empty)'} `));
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '\u2192';
      what.appendChild(arrow);
      what.appendChild(document.createTextNode(` ${entry.new_value || '(empty)'}`));
      if (entry.ticket) {
        const ticket = document.createElement('span');
        ticket.className = 'recent-tkt';
        ticket.textContent = `  ticket ${entry.ticket}`;
        what.appendChild(ticket);
      }

      line.append(when, who, what);
      box.appendChild(line);
    }

    if (!rows.length) {
      const none = document.createElement('p');
      none.className = 'muted';
      none.textContent = 'Nothing has been changed yet. Corrections made here show up in this list '
        + 'with who made them.';
      box.appendChild(none);
    }

    /* Who has been at work, rather than only what they did. */
    const day = 24 * 60 * 60 * 1000;
    const since = (ms) => LOG.entries.filter((e) => Date.now() - new Date(e.at).getTime() < ms);
    const today = since(day);
    const week = since(7 * day);
    const hands = [...new Set(week.map((e) => e.actor))];
    $('recent-line').textContent = LOG.total
      ? `${nf.format(today.length)} change${today.length === 1 ? '' : 's'} today, `
        + `${nf.format(week.length)} this week`
        + (hands.length ? ` by ${hands.length === 1 ? hands[0] : `${hands.length} people`}` : '')
        + `. ${nf.format(LOG.total)} in all.`
      : '\u00a0';
  }

  $('recent-all').addEventListener('click', () => {
    if (window.registerTabs) window.registerTabs.show('log');
    $('log-q').focus();
  });

  /* ---------- change log ---------- */

  /* The days picked, as the start of the first and the end of the last
     in this browser's own time zone, so "the 3rd" means the 3rd here. */
  const localDay = (value, after = 0) => {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d + after);
  };
  function logRange() {
    const query = new URLSearchParams();
    if ($('log-from').value) query.set('from', localDay($('log-from').value).toISOString());
    if ($('log-to').value) query.set('to', localDay($('log-to').value, 1).toISOString());
    return query;
  }
  let LOG_RANGE = null;
  async function loadRange() {
    const query = logRange();
    $('log-clear').hidden = ![...query.keys()].length;
    if (![...query.keys()].length) { LOG_RANGE = null; logView(); return; }
    query.set('limit', '5000');
    try {
      LOG_RANGE = await api(`/api/audit?${query}`);
    } catch (error) {
      LOG_RANGE = { entries: [], total: 0 };
      $('log-count').textContent = error.message;
    }
    logView();
  }

  function logView() {
    const shown = LOG_RANGE || LOG;
    const q = $('log-q').value.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const match = (e) => terms.every((t) => [e.actor, e.name, e.serial, e.holder_id, e.ticket,
      e.field, e.old_value, e.new_value].join(' ').toLowerCase().includes(t));
    const list = shown.entries.filter(match);

    const body = $('log-body');
    body.replaceChildren();
    if (!list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'empty';
      td.textContent = LOG_RANGE ? 'Nothing was changed on those days.'
        : (LOG.entries.length ? 'Nothing in the log matches that.' : 'Nothing has been changed yet.');
      tr.appendChild(td);
      body.appendChild(tr);
    }
    for (const e of list.slice(0, 1000)) {
      const tr = document.createElement('tr');
      for (const text of [
        new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
        e.actor,
        e.name || e.serial || e.holder_id,
        fieldLabel(e),
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
    const days = LOG_RANGE ? ` on the days picked` : '';
    $('log-count').textContent = terms.length
      ? `Showing ${nf.format(list.length)} of ${nf.format(shown.entries.length)} changes${days}.`
      : `${nf.format(shown.entries.length)} change${shown.entries.length === 1 ? '' : 's'}${days}`
        + (shown.total > shown.entries.length ? ` of ${nf.format(shown.total)} in all, newest first.` : ', newest first.');
    $('log-note').textContent = 'Every correction anyone makes, with who made it and the ticket it was '
      + 'made under. A link shows up under the name you gave it. Nothing in the log can be deleted.';
  }

  /* After a merge the log has new lines in it; this pulls them in without
     a reload, and quietly does nothing for a role that cannot see the log. */
  /* Several changes in a row ask once. The data-quality list is the
     heaviest answer the server gives, so it is asked for only while a tab
     that shows it is open (Needs attention, and People for its possible
     duplicates), and otherwise when somebody opens one. */
  let logTimer = null;
  let problemsStale = false;
  const PROBLEM_PANELS = ['panel-attention', 'panel-people'];
  const attentionOpen = () => PROBLEM_PANELS.some((id) => !$(id).hidden);
  function loadProblems() {
    problemsStale = false;
    api('/api/problems').then((found) => { PROBLEMS = found; problems(); }).catch(() => {});
  }
  function refreshLog() {
    if (!canEdit()) return;
    clearTimeout(logTimer);
    logTimer = setTimeout(() => {
      api('/api/audit?limit=1000').then((log) => { LOG = log; logView(); recent(); }).catch(() => {});
      if (LOG_RANGE) loadRange();
      problemsStale = true;
      if (attentionOpen()) loadProblems();
    }, 120);
  }
  const whenShown = new MutationObserver(() => { if (problemsStale && attentionOpen()) loadProblems(); });
  for (const id of PROBLEM_PANELS) whenShown.observe($(id), { attributes: true, attributeFilter: ['hidden'] });

  $('log-q').addEventListener('input', logView);
  for (const id of ['log-from', 'log-to']) $(id).addEventListener('change', loadRange);
  $('log-clear').addEventListener('click', () => {
    $('log-from').value = '';
    $('log-to').value = '';
    loadRange();
  });
  $('log-export').addEventListener('click', () => {
    const query = logRange();
    location.href = `/api/audit.csv${[...query.keys()].length ? `?${query}` : ''}`;
  });

  /* ---------- admin panel ---------- */

  /* Anybody who holds nothing, not only somebody typed in here: the
     workbook is retired, so no import brings a deleted person back. */
  function loadAdded() {
    const box = $('added');
    if (!box || session.role !== 'admin') return;
    const assets = assetsNow();
    const holds = (row) => (assets ? assets.some((a) => a.holder_id === row.id) : row.n > 0);
    const q = $('added-q').value.trim().toLowerCase();
    const free = HOLDERS.filter((row) => !holds(row));
    const rows = free.filter((row) => !q || row.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const SHOW_PEOPLE = 40;
    $('added-line').textContent = `${nf.format(free.length)} ${free.length === 1 ? 'person holds' : 'people hold'} nothing`
      + (q ? `, ${nf.format(rows.length)} matching.` : '.')
      + (rows.length > SHOW_PEOPLE ? ` Showing the first ${SHOW_PEOPLE}; type a name to narrow it.` : '');
    box.replaceChildren();
    for (const row of rows.slice(0, SHOW_PEOPLE)) {
      const line = document.createElement('div');
      line.className = 'folded';
      const who = document.createElement('span');
      who.textContent = row.name + (row.resigned ? ' · resigned' : '') + (row.createdHere ? ' · added here' : '');
      line.appendChild(who);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rowbtn';
      button.textContent = 'Delete';
      button.setAttribute('aria-label', `Delete ${row.name}`);
      button.addEventListener('click', async () => {
        const ticket = await askTicket({
          title: `Delete ${row.name}`,
          text: 'They come off the register for good. The change log keeps every line about them, under their name.',
          go: 'Delete',
        });
        if (!ticket) return;
        button.disabled = true;
        try {
          const out = await api(`/api/holders/${encodeURIComponent(row.id)}`, {
            method: 'DELETE', body: JSON.stringify({ ticket }),
          });
          HOLDERS = out.holders;
          FLEET = out.fleet;
          draw();
          say(`${out.removed} deleted. Ticket ${ticket} is on the change log.`, 'good');
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

  $('added-q').addEventListener('input', () => loadAdded());

  /* ---------- backups ---------- */

  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  /* The last backup, beside the version, for admin and editor links. Red
     once it is a week old or there is none, which is when it matters. An
     admin clicks it to get to the Backups card. */
  function showLastBackup(at) {
    const stamp = $('last-backup');
    if (at === undefined || !canEdit()) { stamp.hidden = true; return; }
    const stale = !at || Date.now() - new Date(at).getTime() > WEEK;
    stamp.textContent = at ? `Last backup ${when(at)}` : 'No backup yet';
    stamp.dataset.state = stale ? 'stale' : 'ok';
    stamp.dataset.role = session.role;
    stamp.title = session.role === 'admin'
      ? (stale ? 'Make a backup now, under Settings' : 'Backups, under Settings')
      : (stale ? 'Ask the IT admin to back up the register' : 'When the register was last backed up');
    stamp.hidden = false;
  }
  $('last-backup').addEventListener('click', () => {
    if (session.role !== 'admin') return;
    if (window.registerTabs) window.registerTabs.show('settings');
    $('backup-card').scrollIntoView({ block: 'start' });
    $('backup-make').focus();
  });

  const sizeOf = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const SHOW_BACKUPS = 15;

  function drawBackups(listed) {
    $('backup-folder').textContent = listed.folder || 'the backups folder';
    const box = $('backup-list');
    box.replaceChildren();
    if (!listed.files.length) {
      const none = document.createElement('p');
      none.className = 'muted';
      none.textContent = 'No backups yet.';
      box.appendChild(none);
    }
    for (const backup of listed.files.slice(0, SHOW_BACKUPS)) {
      const row = document.createElement('div');
      row.className = 'backup-row';
      const at = document.createElement('span');
      at.className = 'when';
      at.textContent = when(backup.at);
      const about = document.createElement('span');
      about.className = 'muted';
      about.textContent = `${sizeOf(backup.size)}, ${{ import: 'made by the workbook import', auto: 'weekly, made automatically' }[backup.source] || 'made here'}`;
      const get = document.createElement('a');
      get.className = 'btn btn-quiet btn-small';
      get.href = `/api/backups/${encodeURIComponent(backup.file)}`;
      get.setAttribute('download', backup.file);
      get.textContent = 'Download';
      get.setAttribute('aria-label', `Download the backup from ${when(backup.at)}`);
      row.append(at, about, get);
      box.appendChild(row);
    }
    if (listed.files.length > SHOW_BACKUPS) {
      const more = document.createElement('p');
      more.className = 'muted';
      more.textContent = `${listed.files.length - SHOW_BACKUPS} older ones are in the folder above.`;
      box.appendChild(more);
    }
    showLastBackup(listed.last ? listed.last.at : null);
  }

  async function loadBackups() {
    try { drawBackups(await api('/api/backups')); } catch { /* not admin, or the folder is unreadable */ }
  }

  $('backup-make').addEventListener('click', async () => {
    const button = $('backup-make');
    button.disabled = true;
    const line = $('backup-line');
    line.removeAttribute('data-state');
    line.textContent = 'Backing up\u2026';
    try {
      const out = await api('/api/backups', { method: 'POST' });
      drawBackups(out);
      line.dataset.state = 'good';
      line.textContent = `Backed up: ${out.made.file}, ${sizeOf(out.made.size)}.`;
      refreshLog();
    } catch (error) {
      line.dataset.state = 'bad';
      line.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  async function loadAdmin() {
    if (session.role !== 'admin') return;
    loadBackups();
    /* The admin's sections are spread over Access links and Settings. */
    for (const section of document.querySelectorAll('[data-admin]')) section.hidden = false;
    loadAdded();
    loadFolded();

    const note = $('link-note');
    const [address] = session.addresses || [];
    if (address && session.announced) {
      note.textContent = `Links below use ${address}, the address this register is published at. `
        + 'Send one to anybody who needs it: they open it and they are in. Nothing to install, '
        + 'no account, no password.';
    } else if (address && linkBase() !== location.origin) {
      note.textContent = `Links below use ${address}, which is how other machines on your network reach this one.`
        + ' They must be on the same network, and this computer must stay on with the register running.'
        + ' On a server, set PUBLIC_URL in .env to the address people really use.';
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
      title.textContent = `${invite.label}: ${invite.role === 'editor' ? 'can correct' : 'can look'}`
        + (invite.revoked ? ' (withdrawn)' : '');
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

  /* ---------- the admin password ---------- */

  const pwSay = (msg, state) => {
    const el = $('pw-line');
    el.textContent = msg;
    if (state) el.dataset.state = state; else el.removeAttribute('data-state');
  };

  $('pw-save').addEventListener('click', async () => {
    const current = $('pw-current').value;
    const next = $('pw-next').value;
    if (!current || !next) { pwSay('Fill in both boxes.', 'bad'); return; }
    if (next.length < 8) { pwSay('The new password needs at least 8 characters.', 'bad'); return; }
    /* The settings file cannot hold these as typed -- the reader strips them
       -- so the password would work now and fail after a restart. */
    if (next !== next.trim() || /^["']/.test(next) || /["']$/.test(next)) {
      pwSay('A password cannot begin or end with a space or a quotation mark: it would stop '
        + 'working the next time the app restarts.', 'bad');
      return;
    }

    $('pw-save').disabled = true;
    pwSay('Changing…');
    try {
      const out = await api('/api/password', {
        method: 'POST',
        body: JSON.stringify({ current, next }),
      });
      $('pw-current').value = '';
      $('pw-next').value = '';
      /* Saved means it survived to .env. Not saved means it is live now but
         goes back to the old one when the app restarts, which somebody needs
         to know rather than find out later. */
      pwSay(out.saved
        ? 'Changed. Every other admin has been signed out; you are still signed in.'
        : 'Changed for now, but it could not be written to the settings file, so a '
          + 'restart puts the old one back. Update the environment this app runs with.',
        out.saved ? 'good' : 'bad');
      refreshLog();
    } catch (e) {
      pwSay(e.message, 'bad');
    } finally {
      $('pw-save').disabled = false;
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
        /* Everyone shares the one password, so without a name every admin
           appears in the change log as the same person. */
        body: JSON.stringify({ password: $('password').value, who: $('who').value }),
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
    showLastBackup(session.lastBackup);
    $('whoami').textContent = session.role === 'admin'
      ? 'Signed in as IT admin'
      : `${session.label}: ${session.role === 'editor' ? 'you can make corrections' : 'you can look only'}`;
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
          .then(([log, found]) => { LOG = log; PROBLEMS = found; logView(); recent(); problems(); })
          .catch(() => { $('log-card').hidden = true; });
      }
    } catch (e) {
      $('rows').replaceChildren();
      $('count').textContent = `The register did not load: ${e.message}`;
    }

    /* The asset side is its own file. It needs the same session, the same
       way of talking to the server, and a way to say "the holders have
       moved, draw them again" after an assignment. */
    let lastSeen = null;
    window.register = {
      api,
      session,
      say,
      refreshLog,
      reload: async () => {
        const [data, changed] = await Promise.all([api('/api/holders'), api('/api/changed').catch(() => null)]);
        if (changed) lastSeen = changed.last;
        HOLDERS = data.holders;
        FLEET = data.fleet;
        draw();
        loadAdded();
        refreshLog();
      },
      holders: () => HOLDERS,
      canEdit,
      askTicket,
      rememberTicket,
      lastTicket: () => lastTicket,
      loadExtras,
      extras: () => EXTRAS,
      waiting: () => WAITING,
      draw: { tiles, mix, fleet, recent },
    };
    window.dispatchEvent(new CustomEvent('register-ready'));

    /* The tags on the people table read the assets, so it is drawn again
       once they are in, and after each change to them. */
    window.addEventListener('assets-loaded', () => { table(); loadAdded(); });

    /* Somebody else's change shows without anybody pressing refresh: every
       half minute, and on coming back to the tab, the page asks whether the
       change log has moved, a few bytes, and reloads only when it has. Not
       while somebody is typing into a cell or has a pop-up open. */
    const busy = () => Boolean(document.querySelector('dialog[open]'))
      || Boolean(document.activeElement && document.activeElement.closest('#rows, #a-body'));
    async function checkChanged() {
      if (document.hidden) return;
      let out;
      try { out = await api('/api/changed'); } catch { return; }
      if (lastSeen === null) { lastSeen = out.last; return; }
      if (out.last === lastSeen || busy()) return;
      lastSeen = out.last;
      try {
        const [data, sum] = await Promise.all([api('/api/holders'), api('/api/summary')]);
        HOLDERS = data.holders;
        FLEET = data.fleet;
        SUMMARY = sum;
        draw();
        loadAdded();
        refreshLog();
        window.dispatchEvent(new CustomEvent('assets-changed'));
      } catch { lastSeen = null; }
    }
    checkChanged();
    setInterval(checkChanged, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkChanged(); });
  })();
})();
