(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat('en');
  const KINDS = ['Laptop only', 'iPad only', 'Both'];
  const DEV_CLASS = { 'Laptop only': 'laptop', 'iPad only': 'ipad', Both: 'both' };
  const TYPES = [['Sales', 'Sales'], ['HO', 'HO'], ['Unknown', 'No type']];
  const TYPE_CLASS = { Sales: 'sales', HO: 'ho', Unknown: 'unknown' };
  const GROUPS = [['Sales', 'Sales'], ['HO', 'Head office'], ['Unknown', 'No type set']];

  let session = { role: null };
  let HOLDERS = [];
  let FLEET = [];
  const view = { q: '', type: '', dev: '', res: '', col: 'name', dir: 1 };

  const canEdit = () => session.role === 'admin' || session.role === 'editor';

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
    const hay = [r.name, r.position, r.department, r.unit, r.lap, r.ipd,
      r.lapM, r.ipdM, r.rem, r.note, r.type, r.status].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  };

  const sorted = (rows) => rows.slice().sort((a, b) => {
    let d;
    if (view.col === 'n') d = a.n - b.n;
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

  const cell = (tr, value, cls) => {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = value === 0 ? '0' : (value || '');
    tr.appendChild(td);
    return td;
  };

  /* Sends one field, shows the row as busy, and puts the control back if the
     server refuses so the page never shows a change that was not saved. */
  async function patch(tr, id, body, revert) {
    tr.classList.add('is-saving');
    try {
      const updated = await api(`/api/holders/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const i = HOLDERS.findIndex((r) => r.id === id);
      if (i >= 0) HOLDERS[i] = updated;
      say('Saved.', 'good');
      tiles();
      mix();
      markRow(tr, updated);
    } catch (e) {
      revert();
      say(e.status === 403 ? 'Your link lets you look, not change.' : `Not saved: ${e.message}`, 'bad');
    } finally {
      tr.classList.remove('is-saving');
    }
  }

  function markRow(tr, r) {
    tr.classList.toggle('is-resigned', r.resigned);
    const who = tr.querySelector('.who');
    const mark = who.querySelector('.edited');
    if (r.overridden || r.resigned || r.note) {
      if (!mark) {
        const e = document.createElement('span');
        e.className = 'edited';
        e.textContent = ' edited';
        who.appendChild(e);
      }
    } else if (mark) mark.remove();
  }

  function buildRow(r) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;

    cell(tr, r.name, 'who');

    const typeTd = document.createElement('td');
    if (canEdit()) {
      const sel = document.createElement('select');
      sel.className = 'sel';
      sel.setAttribute('aria-label', `Type for ${r.name}`);
      for (const [value, text] of TYPES) sel.appendChild(new Option(text, value));
      sel.value = r.type;
      sel.dataset.unset = r.type === 'Unknown' ? 'y' : 'n';
      sel.addEventListener('change', () => {
        const was = r.type;
        const now = sel.value;
        r.type = now;
        sel.dataset.unset = now === 'Unknown' ? 'y' : 'n';
        patch(tr, r.id, { type: now }, () => {
          r.type = was;
          sel.value = was;
          sel.dataset.unset = was === 'Unknown' ? 'y' : 'n';
        });
      });
      typeTd.appendChild(sel);
    } else {
      const pill = document.createElement('span');
      pill.className = `pill pill-${TYPE_CLASS[r.type]}`;
      pill.textContent = r.type === 'Unknown' ? 'No type' : r.type;
      typeTd.appendChild(pill);
    }
    tr.appendChild(typeTd);

    const resTd = document.createElement('td');
    if (canEdit()) {
      const label = document.createElement('label');
      label.className = 'tick';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = r.resigned;
      box.setAttribute('aria-label', `Mark ${r.name} resigned`);
      box.addEventListener('change', () => {
        const was = r.resigned;
        r.resigned = box.checked;
        patch(tr, r.id, { resigned: box.checked }, () => { r.resigned = was; box.checked = was; });
      });
      const text = document.createElement('span');
      text.textContent = 'Resigned';
      label.append(box, text);
      resTd.appendChild(label);
    } else if (r.resigned) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = 'Resigned';
      resTd.appendChild(pill);
    }
    tr.appendChild(resTd);

    const devTd = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `pill pill-${DEV_CLASS[r.status]}`;
    pill.textContent = r.status;
    devTd.appendChild(pill);
    tr.appendChild(devTd);

    cell(tr, r.n, 'c-units num');
    cell(tr, r.position, 'c-pos');
    cell(tr, r.department, 'c-dept');
    cell(tr, r.lap, 'c-lap mono');
    cell(tr, r.ipd, 'c-ipd mono');
    cell(tr, r.rem, 'c-rem rem');

    const noteTd = document.createElement('td');
    noteTd.className = 'c-note';
    if (canEdit()) {
      const input = document.createElement('input');
      input.className = 'txt note-in';
      input.type = 'text';
      input.value = r.note || '';
      input.maxLength = 500;
      input.placeholder = 'Add a note';
      input.setAttribute('aria-label', `Note about ${r.name}`);
      let last = r.note || '';
      const send = () => {
        const now = input.value.trim();
        if (now === last) return;
        const was = last;
        last = now;
        r.note = now;
        patch(tr, r.id, { note: now }, () => { last = was; r.note = was; input.value = was; });
      };
      input.addEventListener('blur', send);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      noteTd.appendChild(input);
    } else {
      noteTd.textContent = r.note || '';
    }
    tr.appendChild(noteTd);

    markRow(tr, r);
    return tr;
  }

  function table() {
    const list = sorted(HOLDERS.filter(matches));
    const body = $('rows');
    const frag = document.createDocumentFragment();
    if (!list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 11;
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
    if (view.q.trim()) bits.push(`matching “${view.q.trim()}”`);
    $('count').textContent = `Showing ${nf.format(list.length)} of ${nf.format(HOLDERS.length)} holders`
      + (bits.length ? ` — ${bits.join(', ')}` : '') + '.';
  }

  const draw = () => { tiles(); mix(); fleet(); table(); };

  /* ---------- admin panel ---------- */

  async function loadAdmin() {
    if (session.role !== 'admin') return;
    $('admin').hidden = false;
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
      url.textContent = `${location.origin}/i/${invite.token}`;
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
            const range = document.createRange();
            range.selectNodeContents(url);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
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
  for (const btn of document.querySelectorAll('thead th button')) {
    btn.addEventListener('click', () => {
      const col = btn.dataset.c;
      view.dir = view.col === col ? -view.dir : 1;
      view.col = col;
      for (const th of document.querySelectorAll('thead th')) th.removeAttribute('aria-sort');
      btn.closest('th').setAttribute('aria-sort', view.dir === 1 ? 'ascending' : 'descending');
      table();
    });
  }
  $('export').addEventListener('click', () => { location.href = '/api/export.csv'; });
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
    $('whoami').textContent = session.role === 'admin'
      ? 'Signed in as IT admin'
      : `${session.label} — ${session.role === 'editor' ? 'you can make corrections' : 'you can look only'}`;
    if (!canEdit()) say('Your link lets you look, not change.');
    try {
      const data = await api('/api/holders');
      HOLDERS = data.holders;
      FLEET = data.fleet;
      draw();
      loadAdmin();
    } catch (e) {
      $('rows').replaceChildren();
      $('count').textContent = `The register did not load: ${e.message}`;
    }
  })();
})();
