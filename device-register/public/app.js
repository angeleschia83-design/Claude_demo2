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
      throw new Error(body.error || 'The server said no.');
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
      td.textContent = 'Nobody matches these filters.';
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

    const dupes = SUMMARY.duplicates || [];
    $('sum-dupes').textContent = dupes.length
      ? `${dupes.length} serial numbers appear more than once in the workbook `
        + `(${dupes.map((d) => d.serial).join(', ')}). A serial is one piece of hardware, so each is `
        + 'counted once here. Three of them are a laptop recorded as both a spare and assigned to somebody, '
        + 'which is worth correcting in the workbook.'
      : '';
  }

  $('sum-pick').addEventListener('change', summary);

  /* ---------- admin panel ---------- */

  async function loadAdmin() {
    if (session.role !== 'admin') return;
    $('admin').hidden = false;

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

    const [invites, log] = await Promise.all([api('/api/invites'), api('/api/audit')]);

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

    const box = $('log');
    box.replaceChildren();
    if (!log.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Nothing changed yet.';
      box.appendChild(p);
    }
    for (const entry of log.slice(0, 80)) {
      const line = document.createElement('div');
      const when = new Date(entry.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      line.textContent = `${when} — ${entry.actor} set ${entry.field} on ${entry.name || entry.holder_id}`
        + ` to ${entry.new_value || '(empty)'}`;
      box.appendChild(line);
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
    } catch (e) {
      $('rows').replaceChildren();
      $('count').textContent = `The register did not load: ${e.message}`;
    }
  })();
})();
