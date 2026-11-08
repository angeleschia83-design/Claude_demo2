/* The asset side of the page: the inventory itself, the words people pick
   from, and a new workbook waiting to be looked at.
   It runs once app.js has a session and hands it one over. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat('en');
  const text = (value) => (value === null || value === undefined ? '' : String(value));

  let api = null;
  let session = null;
  let ASSETS = [];
  let LISTS = { status: [], asset_type: [], model: [] };
  let PLAN = null;
  const view = { q: '', status: '', type: '', held: '' };
  const SHOW = 300;

  const canEdit = () => session && (session.role === 'admin' || session.role === 'editor');
  const say = (id, message, state) => {
    const el = $(id);
    el.textContent = message;
    if (state) el.dataset.state = state; else el.removeAttribute('data-state');
  };

  /* The columns, and which of them is a list rather than free text. */
  const COLUMNS = [
    { key: 'serial', label: 'Serial', cls: 'ser' },
    { key: 'asset_type', label: 'Asset type', list: 'asset_type' },
    { key: 'model', label: 'Model', list: 'model' },
    { key: 'status', label: 'Status', list: 'status' },
    { key: 'holder', label: 'Held by', fixed: true },
    { key: 'assigned_on', label: 'Since', fixed: true },
    { key: 'age_years', label: 'Age' },
    { key: 'host_name', label: 'Host name' },
    { key: 'remarks', label: 'Remark' },
  ];

  /* ---------- the table ---------- */

  const matches = (asset) => {
    if (view.status && text(asset.status) !== view.status) return false;
    if (view.type && text(asset.asset_type) !== view.type) return false;
    if (view.held === 'yes' && !asset.held) return false;
    if (view.held === 'no' && asset.held) return false;
    const terms = view.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = [asset.serial, asset.asset_type, asset.kind, asset.model, asset.status,
      asset.holder, asset.host_name, asset.remarks, asset.os].join(' ').toLowerCase();
    return terms.every((term) => hay.includes(term));
  };

  function buildHead() {
    const tr = $('a-head');
    tr.replaceChildren();
    for (const column of COLUMNS) {
      const th = document.createElement('th');
      th.textContent = column.label;
      tr.appendChild(th);
    }
    const last = document.createElement('th');
    last.textContent = '';
    tr.appendChild(last);
  }

  /* A cell turns into a box when clicked and saves when it loses focus. A
     list column gives a dropdown, because a status typed by hand is how two
     spellings of the same thing get counted twice. */
  function cell(tr, asset, column) {
    const td = document.createElement('td');
    td.className = column.cls || '';
    const paint = () => {
      td.replaceChildren(document.createTextNode(text(asset[column.key]) || '—'));
      if ((asset.changed || []).includes(column.key)) {
        td.classList.add('is-changed');
        td.title = `The workbook says: ${text(asset.base[column.key]) || '(empty)'}`;
      } else td.classList.remove('is-changed');
    };
    paint();
    if (!canEdit() || column.fixed) { tr.appendChild(td); return td; }

    td.tabIndex = 0;
    const open = () => {
      if (td.querySelector('input, select')) return;
      const input = column.list
        ? document.createElement('select')
        : document.createElement('input');
      input.className = 'txt';
      if (column.list) {
        for (const option of [{ value: '' }, ...LISTS[column.list].filter((v) => !v.retired)]) {
          const el = document.createElement('option');
          el.value = option.value || '';
          el.textContent = option.value || '(not set)';
          input.appendChild(el);
        }
        /* A word retired from the list is still shown while this row uses it. */
        if (text(asset[column.key]) && !LISTS[column.list].some((v) => v.value === asset[column.key])) {
          const el = document.createElement('option');
          el.value = asset[column.key];
          el.textContent = asset[column.key];
          input.appendChild(el);
        }
        input.value = text(asset[column.key]);
      } else {
        input.type = 'text';
        input.value = text(asset[column.key]);
      }
      td.replaceChildren(input);
      input.focus();

      let done = false;
      const close = async (save) => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (!save || next === text(asset[column.key])) { paint(); return; }
        td.textContent = '…';
        try {
          const row = await api(`/api/assets/${encodeURIComponent(asset.serial)}`, {
            method: 'PATCH',
            body: JSON.stringify({ [column.key]: next }),
          });
          Object.assign(asset, row);
          paint();
          say('a-count', `${column.label} saved.`, 'good');
          if (column.key === 'serial') draw();
        } catch (error) {
          paint();
          say('a-count', error.message, 'bad');
        }
      };
      input.addEventListener('blur', () => close(true));
      input.addEventListener('change', () => { if (column.list) close(true); });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); close(true); }
        if (event.key === 'Escape') { event.preventDefault(); close(false); }
      });
    };
    td.addEventListener('click', open);
    td.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
    tr.appendChild(td);
    return td;
  }

  function draw() {
    const all = ASSETS.filter(matches);
    const body = $('a-body');
    body.replaceChildren();

    for (const asset of all.slice(0, SHOW)) {
      const tr = document.createElement('tr');
      for (const column of COLUMNS) {
        if (column.key === 'holder') {
          const td = document.createElement('td');
          const pill = document.createElement('span');
          pill.className = 'pill';
          pill.dataset.out = asset.held ? 'yes' : 'no';
          pill.textContent = asset.held ? text(asset.holder) || 'somebody' : 'in stock';
          td.appendChild(pill);
          tr.appendChild(td);
          continue;
        }
        cell(tr, asset, column);
      }

      const act = document.createElement('td');
      if (canEdit()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rowbtn';
        button.textContent = asset.held ? 'Take it back' : 'Hand it out';
        button.addEventListener('click', () => (asset.held ? takeBack(asset) : handOut(asset)));
        act.appendChild(button);
      }
      tr.appendChild(act);
      body.appendChild(tr);
    }

    if (!all.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = COLUMNS.length + 1;
      td.className = 'empty';
      td.textContent = 'No asset matches that.';
      tr.appendChild(td);
      body.appendChild(tr);
    }

    const held = all.filter((asset) => asset.held).length;
    const line = `${nf.format(all.length)} of ${nf.format(ASSETS.length)} assets — `
      + `${nf.format(held)} out with somebody, ${nf.format(all.length - held)} in stock.`
      + (all.length > SHOW ? ` Showing the first ${SHOW}; search to narrow it.` : '');
    say('a-count', line);
  }

  const fillSelect = (id, values, firstLabel) => {
    const select = $(id);
    const chosen = select.value;
    select.replaceChildren();
    const any = document.createElement('option');
    any.value = '';
    any.textContent = firstLabel;
    select.appendChild(any);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value.value;
      option.textContent = value.value + (value.retired ? ' (not offered)' : '');
      select.appendChild(option);
    }
    select.value = chosen;
  };

  const fillPickers = () => {
    fillSelect('a-status', LISTS.status, 'Any status');
    fillSelect('a-type', LISTS.asset_type, 'Any asset type');
    fillSelect('n-status', LISTS.status.filter((v) => !v.retired), '(not set)');
    fillSelect('n-type', LISTS.asset_type.filter((v) => !v.retired), '(not set)');
    fillSelect('n-model', LISTS.model.filter((v) => !v.retired), '(not set)');
  };

  /* ---------- handing hardware out ---------- */

  let pending = null;

  function handOut(asset) {
    pending = { asset, ticket: '' };
    $('assign-title').textContent = `Hand out ${asset.serial}`;
    $('assign-who').value = '';
    $('assign-ticket').value = '';
    $('assign-reasons').hidden = true;
    say('assign-line', `${[asset.asset_type, asset.model].filter(Boolean).join(' ')}`);

    const list = $('holder-list');
    list.replaceChildren();
    for (const holder of window.register.holders()) {
      const option = document.createElement('option');
      option.value = holder.name;
      list.appendChild(option);
    }
    $('assign-dlg').showModal();
  }

  async function assign() {
    const name = $('assign-who').value.trim();
    const holder = window.register.holders().find((row) => row.name.toLowerCase() === name.toLowerCase());
    if (!holder) { say('assign-line', 'Pick a name from the register.', 'bad'); return; }
    const ticket = $('assign-ticket').value.trim();

    say('assign-line', 'Assigning…');
    try {
      const out = await api(`/api/assets/${encodeURIComponent(pending.asset.serial)}/assign`, {
        method: 'POST',
        body: JSON.stringify({ holder_id: holder.id, ticket }),
      });
      Object.assign(pending.asset, out.asset);
      $('assign-dlg').close();
      await refresh();
      await window.register.reload();
      say('a-count', `${out.asset.serial} is now with ${holder.name}.`
        + (ticket ? ` Ticket ${ticket} is on the change log.` : ''), 'good');
    } catch (error) {
      /* 409 is the register stopping to ask, not a failure. */
      if (error.body && error.body.needTicket) {
        $('assign-reasons').hidden = false;
        $('assign-why').textContent = error.body.reasons.map((reason) => reason.say).join(' ')
          + ' Give a ticket number to do it anyway.';
        say('assign-line', 'This one needs a ticket number.', 'bad');
        $('assign-ticket').focus();
        return;
      }
      say('assign-line', error.message, 'bad');
    }
  }

  async function takeBack(asset) {
    const available = LISTS.status.find((value) => /available/i.test(value.value) && !value.retired);
    try {
      const out = await api(`/api/assets/${encodeURIComponent(asset.serial)}/return`, {
        method: 'POST',
        body: JSON.stringify({ status: available ? available.value : '' }),
      });
      Object.assign(asset, out.asset);
      await refresh();
      await window.register.reload();
      say('a-count', `${asset.serial} is back in stock.`, 'good');
    } catch (error) {
      say('a-count', error.message, 'bad');
    }
  }

  /* ---------- adding things ---------- */

  $('a-add').addEventListener('click', () => {
    $('a-new').hidden = !$('a-new').hidden;
    if (!$('a-new').hidden) $('n-serial').focus();
  });
  $('n-cancel').addEventListener('click', () => { $('a-new').hidden = true; });

  $('a-new').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      serial: $('n-serial').value.trim(),
      kind: $('n-kind').value,
      asset_type: $('n-type').value,
      model: $('n-model').value,
      status: $('n-status').value,
    };
    try {
      await api('/api/assets', { method: 'POST', body: JSON.stringify(body) });
      $('n-serial').value = '';
      $('a-new').hidden = true;
      await refresh();
      view.q = body.serial;
      $('a-q').value = body.serial;
      draw();
      say('a-count', `${body.serial} added.`, 'good');
    } catch (error) {
      say('a-count', error.message, 'bad');
    }
  });

  $('h-add').addEventListener('click', () => {
    $('p-name').value = '';
    say('person-line', ' ');
    $('person-dlg').showModal();
  });
  $('person-cancel').addEventListener('click', () => $('person-dlg').close());
  $('person-go').addEventListener('click', async () => {
    const body = {
      name: $('p-name').value.trim(),
      type: $('p-type').value,
      position: $('p-pos').value.trim(),
      department: $('p-dept').value.trim(),
    };
    if (!body.name) { say('person-line', 'A person needs a name.', 'bad'); return; }
    try {
      const holder = await api('/api/holders', { method: 'POST', body: JSON.stringify(body) });
      $('person-dlg').close();
      await window.register.reload();
      window.register.say(`${holder.name} added. They hold nothing yet — hand them something `
        + 'from the Assets section.', 'good');
    } catch (error) {
      say('person-line', error.message, 'bad');
    }
  });

  $('assign-cancel').addEventListener('click', () => $('assign-dlg').close());
  $('assign-go').addEventListener('click', assign);

  /* ---------- the lists ---------- */

  function drawLists() {
    const box = $('lists');
    box.replaceChildren();
    const titles = { status: 'Status', asset_type: 'Asset type', model: 'Model' };

    for (const [kind, values] of Object.entries(LISTS)) {
      const card = document.createElement('div');
      card.className = 'listbox';
      const head = document.createElement('h3');
      head.textContent = `${titles[kind]} — ${values.length}`;
      card.appendChild(head);

      const ul = document.createElement('ul');
      for (const value of values) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = value.value + (value.retired ? ' · not offered' : '');
        li.appendChild(name);

        if (kind === 'status' && session.role === 'admin') {
          const label = document.createElement('label');
          label.className = 'tick';
          const box2 = document.createElement('input');
          box2.type = 'checkbox';
          box2.checked = value.assignable;
          box2.addEventListener('change', async () => {
            try {
              LISTS[kind] = await api(`/api/lists/${kind}/${encodeURIComponent(value.value)}`, {
                method: 'PATCH',
                body: JSON.stringify({ assignable: box2.checked }),
              });
            } catch (error) { box2.checked = !box2.checked; }
          });
          label.append(box2, document.createTextNode('can be handed out'));
          li.appendChild(label);
        }
        ul.appendChild(li);
      }
      card.appendChild(ul);

      if (canEdit()) {
        const form = document.createElement('form');
        const input = document.createElement('input');
        input.className = 'txt';
        input.placeholder = `Add a ${titles[kind].toLowerCase()}…`;
        input.maxLength = 80;
        const button = document.createElement('button');
        button.className = 'btn btn-small';
        button.textContent = 'Add';
        form.append(input, button);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            LISTS[kind] = await api(`/api/lists/${kind}`, {
              method: 'POST', body: JSON.stringify({ value: input.value }),
            });
            input.value = '';
            drawLists();
            fillPickers();
          } catch (error) {
            input.setCustomValidity(error.message);
            input.reportValidity();
            setTimeout(() => input.setCustomValidity(''), 10);
          }
        });
        card.appendChild(form);
      }
      box.appendChild(card);
    }
  }

  /* ---------- a workbook waiting to be looked at ---------- */

  function drawWorkbook(plan) {
    PLAN = plan;
    const card = $('workbook-card');
    if (!plan || plan.waiting === false) { card.hidden = true; return; }
    card.hidden = false;

    const rows = [...plan.holders.changes, ...plan.devices.changes];
    const added = [...plan.holders.added, ...plan.devices.added];
    const gone = [...plan.holders.gone, ...plan.devices.gone];

    const body = $('wb-body');
    body.replaceChildren();

    const line = (state, key, name, label, showing, now, why) => {
      const tr = document.createElement('tr');
      tr.dataset.state = state;
      const pick = document.createElement('td');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.key = key;
      box.checked = state === 'change';
      box.setAttribute('aria-label', `Take ${label} for ${name}`);
      pick.appendChild(box);
      tr.appendChild(pick);
      for (const value of [name, label, showing, now]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      const last = document.createElement('td');
      last.className = 'why';
      last.textContent = why || '';
      tr.appendChild(last);
      body.appendChild(tr);
    };

    for (const row of rows) {
      line(row.state, row.key, row.name, row.label, row.showing || '(empty)', row.now || '(empty)',
        row.state === 'clash'
          ? 'Somebody corrected this here. Taking the workbook’s value drops that correction.'
          : '');
    }
    for (const row of added) {
      line('added', `add:${row.kind}:${row.id}`, row.label, row.kind === 'holder' ? 'New person' : 'New asset',
        '—', row.summary, 'Not in the register yet.');
    }
    for (const row of gone) {
      line('gone', `gone:${row.kind}:${row.id}`, row.label, row.kind === 'holder' ? 'Person' : 'Asset',
        row.summary, '—', 'The workbook no longer lists it. Ticking this removes it here.');
    }

    const bits = [];
    if (plan.totals.change) bits.push(`${plan.totals.change} to take`);
    if (plan.totals.clash) bits.push(`${plan.totals.clash} that would undo a correction`);
    if (plan.totals.added) bits.push(`${plan.totals.added} new`);
    if (plan.totals.gone) bits.push(`${plan.totals.gone} gone from the workbook`);
    say('wb-line', bits.length ? bits.join(', ') + '.' : 'Nothing in this workbook differs from the register.');
    $('wb-note').textContent = 'An import no longer writes over the register. The workbook read on '
      + `${plan.at ? new Date(plan.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'the last import'}`
      + ' is held here until somebody goes through it. Nothing is written until you tick it.';
    $('wb-result').hidden = !(rows.length + added.length + gone.length);
    $('wb-apply').disabled = false;
  }

  $('wb-all').addEventListener('change', (event) => {
    for (const box of document.querySelectorAll('#wb-body input[type="checkbox"]')) {
      box.checked = event.target.checked;
    }
  });

  $('wb-apply').addEventListener('click', async () => {
    const picked = [...document.querySelectorAll('#wb-body input:checked')].map((box) => box.dataset.key);
    if (!picked.length) { say('wb-line', 'Nothing is ticked.', 'bad'); return; }
    $('wb-apply').disabled = true;
    try {
      const out = await api('/api/workbook/apply', { method: 'POST', body: JSON.stringify({ picked }) });
      await refresh();
      await window.register.reload();
      drawWorkbook(out.plan);
      say('wb-line', `Took ${out.fields} field${out.fields === 1 ? '' : 's'}, added ${out.added}, `
        + `removed ${out.gone}. Everything taken is in the change log.`, 'good');
    } catch (error) {
      say('wb-line', error.message, 'bad');
    } finally {
      $('wb-apply').disabled = false;
    }
  });

  $('wb-discard').addEventListener('click', async () => {
    await api('/api/workbook/discard', { method: 'POST' });
    $('workbook-card').hidden = true;
  });

  /* ---------- loading ---------- */

  async function refresh() {
    const out = await api('/api/assets');
    ASSETS = out.assets;
    LISTS = out.lists;
    fillPickers();
    drawLists();
    draw();
  }

  for (const [id, key] of [['a-q', 'q'], ['a-status', 'status'], ['a-type', 'type'], ['a-held', 'held']]) {
    $(id).addEventListener('input', () => { view[key] = $(id).value; draw(); });
  }

  /* A hand-back can carry asset corrections, so the table is reloaded when
     one is applied. */
  window.addEventListener('assets-changed', () => { refresh().catch(() => {}); });

  window.addEventListener('register-ready', async () => {
    ({ api, session } = window.register);
    if (!session || !session.role) return;
    $('assets-card').hidden = false;
    $('lists-card').hidden = false;
    if (!canEdit()) $('h-add').hidden = true;
    buildHead();
    try {
      await refresh();
    } catch (error) {
      say('a-count', `The assets did not load: ${error.message}`, 'bad');
    }
    if (session.role === 'admin') {
      try {
        drawWorkbook(await api('/api/workbook'));
      } catch (error) { /* no workbook waiting */ }
    }
  });
})();
