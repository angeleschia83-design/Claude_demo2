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
    { key: 'invoice_date', label: 'Invoice date', date: true },
    { key: 'purchased_on', label: 'Purchase date', date: true },
    { key: 'remarks', label: 'Remark' },
  ];

  /* ---------- the table ---------- */

  const waitingNow = () => (window.register && window.register.waiting ? window.register.waiting() : new Map());
  const ticketFor = (options) => window.register.askTicket(options);
  /* Status and serial are what an audit follows; the rest are corrections. */
  const AUDITED = new Set(['status', 'serial']);

  const matches = (asset) => {
    if (view.status && text(asset.status) !== view.status) return false;
    if (view.type && text(asset.asset_type) !== view.type) return false;
    if (view.held === 'yes' && !asset.held) return false;
    if (view.held === 'no' && asset.held) return false;
    if (view.held === 'retrieve' && !waitingNow().has(asset.serial)) return false;
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
      /* Hardware waiting to come back says so on its own row, in place of
         the bare status word. */
      const waiting = column.key === 'status' && waitingNow().get(asset.serial);
      if (waiting) {
        const tag = document.createElement('span');
        tag.className = 'tag tag-wait';
        tag.textContent = `${text(asset.status)}${waiting.since ? ` since ${waiting.since}` : ''}`;
        td.replaceChildren(tag);
      } else {
        td.replaceChildren(document.createTextNode(text(asset[column.key]) || ''));
      }
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
      /* Nothing may be opened while the last edit is still on its way to the
         server: a second box would be filled from the value the cell is in
         the middle of replacing, and would write it straight back. */
      if (td.dataset.saving) return;
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
        /* A date column gets the calendar, so the one shape the register
           stores is the only shape anybody can enter. */
        input.type = column.date ? 'date' : 'text';
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
        const body = { [column.key]: next };
        if (AUDITED.has(column.key)) {
          paint();
          const ticket = await ticketFor({
            title: `${column.label} of ${asset.serial}`,
            text: `From "${text(asset[column.key]) || '(not set)'}" to "${next || '(not set)'}".`,
          });
          if (!ticket) return;
          body.ticket = ticket;
        }
        td.textContent = '…';
        td.dataset.saving = '1';
        try {
          const row = await api(`/api/assets/${encodeURIComponent(asset.serial)}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          });
          Object.assign(asset, row);
          paint();
          /* A status can put a piece on, or take it off, the to-retrieve
             list, and the dashboard counts by it. */
          if (AUDITED.has(column.key)) await refresh();
          say('a-count', `${column.label} of ${asset.serial} saved.`
            + (body.ticket ? ` Ticket ${body.ticket} is on the change log.` : ''), 'good');
          window.register.refreshLog();
        } catch (error) {
          paint();
          say('a-count', error.message, 'bad');
        } finally {
          delete td.dataset.saving;
        }
      };
      input.addEventListener('blur', () => close(true));
      input.addEventListener('change', () => { if (column.list) close(true); });
      /* The cell itself opens a box on Enter, so a key this box has already
         dealt with must not reach it. Without that, Enter saved the new value
         and the box the cell then opened — still holding the old one — wrote
         it back the moment it lost focus, over a "saved" message. */
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close(event.key === 'Enter');
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

        /* Only once it is in nobody's hands, so who had it is never lost
           along with the record. */
        if (!asset.held) {
          const off = document.createElement('button');
          off.type = 'button';
          off.className = 'rowbtn';
          off.textContent = 'Take it off';
          off.title = 'Take this asset off the register';
          off.addEventListener('click', () => openRemove(asset));
          act.appendChild(off);
        }
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
    const line = `${nf.format(all.length)} of ${nf.format(ASSETS.length)} assets: `
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
    $('assign-ticket').value = window.register.lastTicket();
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
    if (!ticket) { say('assign-line', 'A ticket number is needed.', 'bad'); $('assign-ticket').focus(); return; }
    window.register.rememberTicket(ticket);

    /* Ask first, without the ticket, what this would run into: a leaver, a
       second laptop, hardware already with somebody. The warning is shown
       once; pressing Assign it again goes ahead. */
    if (pending.warnedFor !== holder.id) {
      say('assign-line', 'Checking…');
      try {
        await api(`/api/assets/${encodeURIComponent(pending.asset.serial)}/assign`, {
          method: 'POST', body: JSON.stringify({ holder_id: holder.id }),
        });
      } catch (error) {
        const reasons = (error.body && error.body.reasons) || [];
        if (!(error.body && error.body.needTicket)) { say('assign-line', error.message, 'bad'); return; }
        if (reasons.length) {
          pending.warnedFor = holder.id;
          $('assign-reasons').hidden = false;
          $('assign-why').textContent = `${reasons.map((reason) => reason.say).join(' ')} Press Assign it again to go ahead under ticket ${ticket}.`;
          say('assign-line', 'Read this first.', 'bad');
          return;
        }
      }
    }

    say('assign-line', 'Assigning…');
    try {
      const out = await api(`/api/assets/${encodeURIComponent(pending.asset.serial)}/assign`, {
        method: 'POST',
        body: JSON.stringify({ holder_id: holder.id, ticket }),
      });
      Object.assign(pending.asset, out.asset);
      $('assign-dlg').close();
      await Promise.all([refresh(), window.register.reload()]);
      say('a-count', `${out.asset.serial} is now with ${holder.name}. Ticket ${ticket} is on the change log.`, 'good');
    } catch (error) {
      /* 409 is the register stopping to ask, not a failure. */
      if (error.body && error.body.needTicket) {
        $('assign-reasons').hidden = false;
        $('assign-why').textContent = (error.body.reasons || []).map((reason) => reason.say).join(' ')
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
    const ticket = await ticketFor({
      title: `Take ${asset.serial} back`,
      text: `From ${text(asset.holder) || 'whoever has it'}, into stock${available ? ` as "${available.value}"` : ''}.`,
      go: 'Take it back',
    });
    if (!ticket) return;
    try {
      const out = await api(`/api/assets/${encodeURIComponent(asset.serial)}/return`, {
        method: 'POST',
        body: JSON.stringify({ status: available ? available.value : '', ticket }),
      });
      Object.assign(asset, out.asset);
      await Promise.all([refresh(), window.register.reload()]);
      say('a-count', `${asset.serial} is back in stock. Ticket ${ticket} is on the change log.`, 'good');
    } catch (error) {
      say('a-count', error.message, 'bad');
    }
  }

  /* ---------- an asset that should not be here ---------- */

  let removing = null;

  function openRemove(asset) {
    removing = asset;
    $('remove-title').textContent = `Take ${asset.serial} off the register`;
    $('remove-why').value = '';
    $('remove-ticket').value = window.register.lastTicket();
    $('remove-hard').checked = false;
    /* Only an admin deletes outright, and only what nobody holds, which is
       all this dialog is offered for. The change log keeps its lines. */
    const canDelete = session.role === 'admin';
    $('remove-hard-row').hidden = !canDelete;
    $('remove-note').textContent = 'Taken off, it stays in the database with its history, and an admin can put it back.'
      + (canDelete ? ' Deleted, it is gone from the register for good; the change log still has every line about it.' : '');
    say('remove-line', '\u00a0');
    $('remove-dlg').showModal();
    $('remove-why').focus();
  }

  $('remove-cancel').addEventListener('click', () => $('remove-dlg').close());
  $('remove-go').addEventListener('click', async () => {
    if (!removing) return;
    const hard = $('remove-hard').checked;
    const ticket = $('remove-ticket').value.trim();
    if (!ticket) { say('remove-line', 'A ticket number is needed.', 'bad'); $('remove-ticket').focus(); return; }
    window.register.rememberTicket(ticket);
    say('remove-line', hard ? 'Deleting\u2026' : 'Taking it off\u2026');
    try {
      const out = await api(`/api/assets/${encodeURIComponent(removing.serial)}/remove`, {
        method: 'POST',
        body: JSON.stringify({ reason: $('remove-why').value.trim(), hard, ticket }),
      });
      $('remove-dlg').close();
      await refresh();
      $('gone-box').open = true;
      await window.register.reload();
      say('a-count', out.deleted
        ? `${out.deleted} deleted.`
        : `${out.removed} is off the register. An admin can put it back from the list under the table.`,
        'good');
      loadGone();
    } catch (error) {
      say('remove-line', error.message, 'bad');
    }
  });

  async function loadGone() {
    const box = $('gone');
    if (!box) return;
    let rows = [];
    try { rows = await api('/api/assets/removed'); } catch (error) { return; }
    $('gone-box').hidden = rows.length === 0;
    box.replaceChildren();
    for (const asset of rows) {
      const line = document.createElement('div');
      line.className = 'folded';
      const what = document.createElement('span');
      what.textContent = `${asset.serial}: ${[asset.asset_type, asset.model].filter(Boolean).join(' ')}`
        + `${asset.removed_reason ? ` (${asset.removed_reason})` : ''}`;
      line.appendChild(what);
      if (session.role === 'admin') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rowbtn';
        button.textContent = 'Put it back';
        button.addEventListener('click', async () => {
          const ticket = await ticketFor({ title: `Put ${asset.serial} back on the register`, go: 'Put it back' });
          if (!ticket) return;
          button.disabled = true;
          try {
            await api(`/api/assets/${encodeURIComponent(asset.serial)}/restore`, {
              method: 'POST', body: JSON.stringify({ ticket }),
            });
            await refresh();
            say('a-count', `${asset.serial} is back on the register. Ticket ${ticket} is on the change log.`, 'good');
            loadGone();
            window.register.refreshLog();
          } catch (error) {
            button.disabled = false;
            say('a-count', error.message, 'bad');
          }
        });
        line.appendChild(button);
      }
      box.appendChild(line);
    }
  }

  /* ---------- adding things ---------- */

  $('a-add').addEventListener('click', () => {
    $('a-new').hidden = !$('a-new').hidden;
    if (!$('a-new').hidden) {
      if (!$('n-ticket').value) $('n-ticket').value = window.register.lastTicket();
      $('n-serial').focus();
    }
  });
  $('n-cancel').addEventListener('click', () => { $('a-new').hidden = true; });

  /* Something being added that is already in the register, or looks like
     it: an exact repeat is refused with where it is; a near miss lists the
     likely match, and pressing the button again (now "add anyway") adds it. */
  function showDupes(box, error, describe) {
    const near = error.body && error.body.possibleDuplicates;
    box.replaceChildren();
    if (near) {
      box.append(document.createTextNode(`This looks like ${near.length === 1 ? 'something' : 'things'} already in the register. Check it is not the same before adding it:`));
      const list = document.createElement('ul');
      for (const match of near) {
        const li = document.createElement('li');
        li.textContent = describe(match);
        list.appendChild(li);
      }
      box.appendChild(list);
    } else {
      box.textContent = error.message;
    }
    box.hidden = false;
    return Boolean(near);
  }
  const clearDupes = (box, button, label) => { box.hidden = true; box.replaceChildren(); button.textContent = label; };
  let assetConfirm = false;
  $('n-serial').addEventListener('input', () => { assetConfirm = false; clearDupes($('n-dupe'), $('n-go'), 'Add it'); });

  $('a-new').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      serial: $('n-serial').value.trim(),
      kind: $('n-kind').value,
      asset_type: $('n-type').value,
      model: $('n-model').value,
      status: $('n-status').value,
      invoice_date: $('n-invoice').value,
      purchased_on: $('n-bought').value,
      ticket: $('n-ticket').value.trim(),
      confirm: assetConfirm,
    };
    window.register.rememberTicket(body.ticket);
    try {
      await api('/api/assets', { method: 'POST', body: JSON.stringify(body) });
      $('n-serial').value = '';
      $('n-invoice').value = '';
      $('n-bought').value = '';
      assetConfirm = false;
      clearDupes($('n-dupe'), $('n-go'), 'Add it');
      window.register.refreshLog();
      $('a-new').hidden = true;
      await refresh();
      view.q = body.serial;
      $('a-q').value = body.serial;
      draw();
      say('a-count', `${body.serial} added. Ticket ${body.ticket} is on the change log.`, 'good');
    } catch (error) {
      if (error.status === 409 || /already in the register/.test(error.message)) {
        assetConfirm = showDupes($('n-dupe'), error, (match) => `${match.serial}: ${match.about}`);
        if (assetConfirm) $('n-go').textContent = 'Add it anyway';
        $('n-serial').focus();
        return;
      }
      say('a-count', error.message, 'bad');
    }
  });

  /* Shared, because the holders table offers this too when a search finds
     nobody — which is the moment somebody usually needs it. */
  function openPerson(name = '') {
    $('p-name').value = name;
    $('p-ticket').value = window.register.lastTicket();
    personConfirm = false;
    clearDupes($('person-dupe'), $('person-go'), 'Add them');
    say('person-line', '\u00a0');
    $('person-dlg').showModal();
    $('p-name').focus();
  }
  window.openPerson = openPerson;
  let personConfirm = false;
  $('p-name').addEventListener('input', () => { personConfirm = false; clearDupes($('person-dupe'), $('person-go'), 'Add them'); });

  $('h-add').addEventListener('click', () => openPerson());
  $('person-cancel').addEventListener('click', () => $('person-dlg').close());
  $('person-go').addEventListener('click', async () => {
    const body = {
      name: $('p-name').value.trim(),
      type: $('p-type').value,
      position: $('p-pos').value.trim(),
      department: $('p-dept').value.trim(),
      ticket: $('p-ticket').value.trim(),
      confirm: personConfirm,
    };
    if (!body.name) { say('person-line', 'A person needs a name.', 'bad'); return; }
    if (!body.ticket) { say('person-line', 'A ticket number is needed.', 'bad'); $('p-ticket').focus(); return; }
    window.register.rememberTicket(body.ticket);
    try {
      const holder = await api('/api/holders', { method: 'POST', body: JSON.stringify(body) });
      $('person-dlg').close();
      await window.register.reload();
      window.register.say(`${holder.name} added. They hold nothing yet: hand them something `
        + 'from the Assets section.', 'good');
    } catch (error) {
      if (error.status === 409 || /already in the register/.test(error.message)) {
        personConfirm = showDupes($('person-dupe'), error,
          (match) => `${match.name}${match.about ? ` (${match.about})` : ''}. ${match.why}`);
        if (personConfirm) $('person-go').textContent = 'Add them anyway';
        say('person-line', '\u00a0');
        $('p-name').focus();
        return;
      }
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

    const used = (kind, value) => ASSETS.filter((asset) => text(asset[kind]) === value).length;
    const chosen = new Set(Object.values((window.register.extras && window.register.extras().statuses) || {})
      .map((entry) => entry && entry.value).filter(Boolean));

    for (const [kind, values] of Object.entries(LISTS)) {
      const card = document.createElement('div');
      card.className = 'listbox';
      const head = document.createElement('h3');
      head.textContent = `${titles[kind]} (${values.length})`;
      card.appendChild(head);

      const ul = document.createElement('ul');
      for (const value of values) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = value.value + (value.retired ? ' · not offered' : '');
        li.appendChild(name);
        const n = used(kind, value.value);
        if (session.role === 'admin') {
          const count = document.createElement('span');
          count.className = 'muted';
          count.textContent = n ? `${nf.format(n)} in use` : 'unused';
          li.appendChild(count);
        }

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
        /* A word nothing uses can go. One in use, or chosen under When
           someone resigns, would leave rows pointing at nothing. */
        if (session.role === 'admin' && !n && !(kind === 'status' && chosen.has(value.value))) {
          const drop = document.createElement('button');
          drop.type = 'button';
          drop.className = 'rowbtn';
          drop.textContent = 'Delete';
          drop.setAttribute('aria-label', `Delete "${value.value}" from the ${titles[kind].toLowerCase()} list`);
          drop.addEventListener('click', async () => {
            const ticket = await ticketFor({ title: `Delete "${value.value}"`, text: `From the ${titles[kind].toLowerCase()} list.`, go: 'Delete' });
            if (!ticket) return;
            try {
              LISTS[kind] = await api(`/api/lists/${kind}/${encodeURIComponent(value.value)}`, {
                method: 'DELETE', body: JSON.stringify({ ticket }),
              });
              drawLists();
              fillPickers();
              say('a-count', `"${value.value}" deleted from the list.`, 'good');
              window.register.refreshLog();
            } catch (error) {
              window.register.say(error.message, 'bad');
            }
          });
          li.appendChild(drop);
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
      box.dataset.state = state;
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
        '(none)', row.summary, 'Not in the register yet.');
    }
    for (const row of gone) {
      line('gone', `gone:${row.kind}:${row.id}`, row.label, row.kind === 'holder' ? 'Person' : 'Asset',
        row.summary, '(none)', 'The workbook no longer lists it. Ticking this removes it here.');
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

  /* Deliberately not the gone rows. Those are deletions, and drawWorkbook
     pre-ticks only the safe changes for a reason; one click on the header
     box used to throw that care away and arm every deletion at once. */
  $('wb-all').addEventListener('change', (event) => {
    for (const box of document.querySelectorAll('#wb-body input[type="checkbox"]')) {
      if (box.dataset.state === 'gone') continue;
      box.checked = event.target.checked;
    }
  });

  $('wb-apply').addEventListener('click', async () => {
    const boxes = [...document.querySelectorAll('#wb-body input:checked')];
    const picked = boxes.map((box) => box.dataset.key);
    if (!picked.length) { say('wb-line', 'Nothing is ticked.', 'bad'); return; }
    /* What each row looked like when it was drawn. The server re-plans at
       apply time and leaves anything that has changed since, so a tick cast
       before somebody else's correction existed cannot overwrite it. */
    const seen = Object.fromEntries(boxes.map((box) => [box.dataset.key, box.dataset.state]));
    const goneCount = boxes.filter((box) => box.dataset.state === 'gone').length;
    if (goneCount && !window.confirm(`${goneCount} row${goneCount === 1 ? '' : 's'} will be deleted `
      + 'from the register, with any corrections made to them here. This cannot be undone. Go ahead?')) {
      return;
    }
    $('wb-apply').disabled = true;
    try {
      const out = await api('/api/workbook/apply', { method: 'POST', body: JSON.stringify({ picked, seen }) });
      await refresh();
      await window.register.reload();
      drawWorkbook(out.plan);
      const left = (out.skipped || []).length;
      say('wb-line', `Took ${out.fields} field${out.fields === 1 ? '' : 's'}, added ${out.added}, `
        + `removed ${out.gone}.`
        + (left ? ` ${left} left alone because ${left === 1 ? 'it' : 'they'} changed while this `
          + 'page was open, or could not be removed safely.' : '')
        + ' Everything taken is in the change log.', 'good');
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
    const [out] = await Promise.all([api('/api/assets'), window.register.loadExtras()]);
    ASSETS = out.assets;
    LISTS = out.lists;
    fillPickers();
    drawLists();
    draw();
    /* The resign pop-up and the dashboard read the same rows rather than
       asking the server again. */
    window.register.assets = () => ASSETS;
    window.register.lists = () => LISTS;
    window.dispatchEvent(new CustomEvent('assets-loaded'));
  }

  /* The audit list is the rows on screen: the same search and filters go
     to the server, which narrows by the same rules (server.mjs,
     /api/assets/audit.xlsx; keep the two in step). */
  $('a-audit').addEventListener('click', () => {
    const query = new URLSearchParams(Object.entries(view).filter(([, value]) => value.trim()));
    location.href = `/api/assets/audit.xlsx${[...query.keys()].length ? `?${query}` : ''}`;
  });

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
      if (canEdit()) loadGone(); else $('gone-box').hidden = true;
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
