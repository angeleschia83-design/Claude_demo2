/* Somebody leaving, and their hardware.
 *
 * Ticking a person resigned always opens this pop-up: one row per piece
 * they hold, each given one of four outcomes, saved together or not at all,
 * under a ticket number. Somebody holding nothing gets it too, for the
 * ticket. The Needs attention tab then lists who is resigned with hardware
 * nobody has decided about (HR's leavers included, who were never asked)
 * and what is still waiting to come back. Settings holds which status each
 * outcome writes.
 *
 * It runs once app.js and assets.js have a session and their rows, and
 * uses their window.register object rather than asking the server twice.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const OUTCOMES = [
    ['retrieve', 'To retrieve'],
    ['available', 'Available'],
    ['decommissioned', 'Decommissioned'],
    ['defective', 'Defective'],
  ];
  const BACK = OUTCOMES.filter(([key]) => key !== 'retrieve');

  let reg = null;
  let STATUSES = null;
  let RETRIEVE = { status: null, rows: [] };
  let current = null;

  const say = (id, message, state) => {
    const el = $(id);
    el.textContent = message || ' ';
    if (state) el.dataset.state = state; else el.removeAttribute('data-state');
  };
  const heldBy = (id) => (reg.assets ? reg.assets() : []).filter((asset) => asset.holder_id === id);
  const what = (asset) => [asset.asset_type || asset.kind, asset.model].filter(Boolean).join(' ');
  const pieces = (n) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  /* app.js reads the to-retrieve list and the status words once for the
     whole page; this only takes its copy. */
  function takeExtras() {
    ({ retrieve: RETRIEVE, statuses: STATUSES } = reg.extras());
  }

  /* ---------- the notice after a resign ---------- */

  let noticeHolder = null;
  function notice(message, holderId) {
    $('notice-text').textContent = message;
    noticeHolder = holderId || null;
    $('notice-show').hidden = !noticeHolder;
    $('notice').hidden = false;
  }
  $('notice-close').addEventListener('click', () => { $('notice').hidden = true; });
  $('notice-show').addEventListener('click', () => {
    if (window.registerTabs) window.registerTabs.show('attention');
    const rows = [...document.querySelectorAll('#panel-attention [data-holder]')]
      .filter((row) => row.dataset.holder === noticeHolder);
    if (rows[0]) rows[0].scrollIntoView({ block: 'center' });
    for (const row of rows) {
      row.classList.remove('is-flash');
      void row.offsetWidth;
      row.classList.add('is-flash');
    }
  });

  /* ---------- the pop-up ---------- */

  function updateGo() {
    const ticket = Boolean($('resign-ticket').value.trim());
    const decided = current.assets.every((a) => current.choices.has(a.serial))
      && (current.assets.length > 0 || !current.already);
    $('resign-go').disabled = !decided || !ticket || current.busy;
    $('resign-later').disabled = !ticket || current.busy;
  }

  function drawRows() {
    const body = $('resign-rows');
    body.replaceChildren();
    for (const asset of current.assets) {
      const group = el('fieldset', { className: 'choices' },
        el('legend', { className: 'sr-only', textContent: `What happens to ${asset.serial}` }));
      for (const [key, label] of OUTCOMES) {
        const radio = el('input', { type: 'radio', name: `resign-${asset.serial}`, value: key });
        radio.checked = current.choices.get(asset.serial) === key;
        radio.addEventListener('change', () => {
          current.choices.set(asset.serial, key);
          $('resign-all').value = '';
          updateGo();
        });
        /* Say which status word the answer writes when it is not the word
           itself, so "To retrieve" can never quietly mean "Lost". */
        const word = STATUSES && STATUSES[key].value;
        group.append(el('label', {}, radio, word && word !== label ? `${label} (${word})` : label));
      }
      body.append(el('tr', {},
        el('td', { textContent: what(asset) || asset.kind }),
        el('td', { className: 'mono', textContent: asset.serial }),
        el('td', { textContent: asset.status || 'No status recorded' }),
        el('td', {}, group)));
    }
    if (!current.assets.length) {
      body.append(el('tr', {}, el('td', { colSpan: 4, className: 'empty',
        textContent: 'Nothing is on their name any more.' })));
    }
    body.closest('.scroll').hidden = !current.assets.length;
    $('resign-all').closest('.controls').hidden = !current.assets.length;
    updateGo();
  }

  function openResign(holder, { already = false } = {}) {
    takeExtras();
    const waiting = STATUSES && STATUSES.retrieve.value;
    /* Somebody already resigned is asked only about what is still open:
       anything already waiting to come back has been decided. */
    const assets = heldBy(holder.id).filter((a) => !already || a.status !== waiting);
    current = { holder, already, assets, choices: new Map(), busy: false };
    $('resign-title').textContent = already
      ? `What happens to ${holder.name}'s hardware`
      : `${holder.name} is leaving`;
    $('resign-when').textContent = holder.lwd ? `Last working day ${holder.lwd}, from HR's list.` : '';
    $('resign-all').value = '';
    $('resign-ticket').value = reg.lastTicket();
    $('resign-note').value = '';
    $('resign-later').hidden = already || !assets.length;
    $('resign-go').textContent = already ? 'Save' : (assets.length ? 'Mark resigned and save' : 'Mark resigned');
    say('resign-line', assets.length
      ? `${pieces(assets.length)} on their name. Choose what happens to each, and give the ticket number.`
      : 'Nothing is on their name. Give the ticket number to mark them resigned.');
    drawRows();
    $('resign-dlg').showModal();
    (assets.length ? $('resign-all') : $('resign-ticket')).focus();
  }

  function outcomeSummary(choices) {
    const counts = new Map();
    for (const outcome of choices.values()) counts.set(outcome, (counts.get(outcome) || 0) + 1);
    return OUTCOMES.filter(([key]) => counts.has(key))
      .map(([key, label]) => `${counts.get(key)} ${label.toLowerCase()}`).join(', ');
  }

  async function afterChange() {
    await reg.reload();
    /* assets.js reloads its table on this, then says assets-loaded, which
       redraws the lists below. */
    window.dispatchEvent(new CustomEvent('assets-changed'));
  }

  async function send(later) {
    const { holder, already, choices } = current;
    const ticket = reg.rememberTicket($('resign-ticket').value.trim());
    const note = $('resign-note').value.trim();
    if (!ticket) { say('resign-line', 'A ticket number is needed.', 'bad'); $('resign-ticket').focus(); return; }
    const held = current.assets.length;
    current.busy = true;
    updateGo();
    say('resign-line', 'Saving…');
    try {
      await reg.api(`/api/holders/${encodeURIComponent(holder.id)}/resign`, {
        method: 'POST',
        body: JSON.stringify({
          choices: later ? [] : [...choices].map(([serial, outcome]) => ({ serial, outcome })),
          ticket, note,
          /* Never "later" for Decide assets: the server leaves out what is
             already waiting to come back, and refuses if anything else on
             their name has no answer, a piece handed over meanwhile included. */
          later,
        }),
      });
      $('resign-dlg').close();
      await afterChange();
      /* Said where it cannot be missed, with the way to the list: the
         hardware is now waiting on somebody to fetch it. */
      const waiting = later ? [] : [...choices].filter(([, outcome]) => outcome === 'retrieve').map(([serial]) => serial);
      const lead = already ? `${holder.name}:` : `${holder.name} is marked resigned.`;
      let message;
      let show = true;
      if (later && held) {
        message = `${lead} ${pieces(held)} still to decide, listed under Needs attention.`;
      } else if (waiting.length) {
        message = `${lead} ${pieces(waiting.length)} tagged To retrieve (${waiting.join(', ')}), `
          + `listed under Needs attention until ${waiting.length === 1 ? 'it comes' : 'they come'} back.`
          + (waiting.length < choices.size ? ` The rest: ${outcomeSummary(new Map([...choices].filter(([, o]) => o !== 'retrieve')))}.` : '');
      } else {
        message = held ? `${lead} ${outcomeSummary(choices)}.` : `${lead} They hold nothing.`;
        show = false;
      }
      notice(`${message} Ticket ${ticket} is on the change log.`, show ? holder.id : null);
      reg.say('Saved.', 'good');
    } catch (error) {
      /* 409: the hardware changed while this was open. Show what is on their
         name now, keeping the choices already made for what is still there. */
      if (error.status === 409) {
        try {
          const fresh = await reg.api('/api/assets');
          const waiting = STATUSES && STATUSES.retrieve.value;
          current.assets = fresh.assets.filter((a) => a.holder_id === holder.id
            && (!already || a.status !== waiting));
          current.choices = new Map([...choices].filter(([serial]) =>
            current.assets.some((a) => a.serial === serial)));
          drawRows();
        } catch { /* keep what is shown */ }
      }
      say('resign-line', error.message, 'bad');
    } finally {
      if (current) { current.busy = false; updateGo(); }
    }
  }

  $('resign-all').addEventListener('change', () => {
    const key = $('resign-all').value;
    if (!key || !current) return;
    for (const asset of current.assets) current.choices.set(asset.serial, key);
    drawRows();
  });
  $('resign-ticket').addEventListener('input', () => { if (current) updateGo(); });
  $('resign-go').addEventListener('click', () => send(false));
  $('resign-later').addEventListener('click', () => send(true));
  $('resign-cancel').addEventListener('click', () => $('resign-dlg').close());

  /* ---------- Needs attention ---------- */

  function drawUndecided() {
    const waiting = RETRIEVE.status;
    const open = reg.holders()
      .filter((h) => h.resigned)
      .map((h) => ({ holder: h, assets: heldBy(h.id).filter((a) => a.status !== waiting) }))
      .filter((row) => row.assets.length)
      .sort((a, b) => a.holder.name.localeCompare(b.holder.name));

    const box = $('undecided');
    box.replaceChildren();
    if (!open.length) {
      box.append(el('p', { className: 'muted', textContent: 'Nobody. Every leaver’s hardware has been decided.' }));
    } else {
      const list = el('ul', { className: 'undecided-list' });
      for (const { holder, assets } of open) {
        const button = el('button', { type: 'button', className: 'btn btn-small', textContent: 'Decide assets' });
        button.addEventListener('click', () => openResign(holder, { already: true }));
        const li = el('li', {},
          el('span', { className: 'who', textContent: holder.name }),
          el('span', { className: 'muted', textContent:
            `${pieces(assets.length)}: ${assets.map((a) => a.serial).join(', ')}`
            + (holder.lwd ? `, left ${holder.lwd}` : '') }),
          button);
        li.dataset.holder = holder.id;
        list.append(li);
      }
      box.append(list);
    }
    $('undecided-card').hidden = false;
    return open.length;
  }

  function drawRetrieve() {
    const body = $('retrieve-rows');
    body.replaceChildren();
    const rows = RETRIEVE.rows;
    say('retrieve-line', rows.length
      ? `${pieces(rows.length)} waiting.`
      : (RETRIEVE.status ? 'Nothing is waiting to come back.' : 'Nothing has been asked for yet.'));

    for (const row of rows) {
      const action = el('td', {});
      const button = el('button', { type: 'button', className: 'btn btn-small btn-quiet', textContent: 'It’s back' });
      button.setAttribute('aria-label', `${row.serial} is back`);
      button.addEventListener('click', () => askBack(row, action));
      action.append(button);
      const tr = el('tr', {},
        el('td', { className: 'mono', textContent: row.serial }),
        el('td', { textContent: [row.asset_type || row.kind, row.model].filter(Boolean).join(' ') }),
        el('td', { textContent: row.holder || 'Nobody' }),
        el('td', { textContent: row.since || 'date not recorded' }),
        action);
      tr.dataset.holder = row.holder_id;
      body.append(tr);
    }
    $('retrieve-card').hidden = false;
    return rows.length;
  }

  /* It's back: which of the three it comes back as. Inline in the row,
     not another pop-up. The server writes the same status words the resign
     pop-up does, adding one the list does not have yet. */
  function askBack(row, cell) {
    const pick = el('select', { className: 'txt' });
    pick.setAttribute('aria-label', `What ${row.serial} comes back as`);
    for (const [key, label] of BACK) {
      const value = STATUSES && STATUSES[key].value;
      pick.append(new Option(value && value !== label ? `${label} (${value})` : label, key));
    }
    const ticket = el('input', { className: 'txt txt-ticket', placeholder: 'Ticket number', maxLength: 60, value: reg.lastTicket() });
    ticket.setAttribute('aria-label', `Ticket number for ${row.serial}`);
    const go = el('button', { type: 'button', className: 'btn btn-small', textContent: 'Take it back' });
    const cancel = el('button', { type: 'button', className: 'btn btn-small btn-quiet', textContent: 'Cancel' });
    cell.replaceChildren(el('div', { className: 'back-row' }, pick, ticket, go, cancel));
    pick.focus();
    cancel.addEventListener('click', drawRetrieve);
    go.addEventListener('click', async () => {
      const number = reg.rememberTicket(ticket.value.trim());
      if (!number) { reg.say('A ticket number is needed to take it back.', 'bad'); ticket.focus(); return; }
      go.disabled = true;
      try {
        const out = await reg.api(`/api/retrieve/${encodeURIComponent(row.serial)}/back`, {
          method: 'POST',
          body: JSON.stringify({ outcome: pick.value, ticket: number }),
        });
        await afterChange();
        reg.say(`${row.serial} is back, as ${out.asset.status}. Ticket ${number} is on the change log.`, 'good');
      } catch (error) {
        go.disabled = false;
        reg.say(error.message, 'bad');
      }
    });
  }

  function reloadAttention() {
    if (!reg || !reg.canEdit()) return;
    takeExtras();
    const count = drawUndecided() + drawRetrieve();
    if (window.registerTabs) window.registerTabs.setCount('attention', count);
  }

  /* ---------- Settings: which status each outcome writes ---------- */

  function drawSettings() {
    if (!reg || reg.session.role !== 'admin' || !STATUSES || !reg.lists) return;
    const offered = reg.lists().status.filter((v) => !v.retired).map((v) => v.value);
    const box = $('resign-map');
    box.replaceChildren();
    for (const [key, label] of OUTCOMES) {
      const now = STATUSES[key];
      const pick = el('select', { className: 'txt', id: `resign-map-${key}` });
      if (!now.value) pick.append(new Option(`None yet: "${label}" is added when first needed`, ''));
      for (const value of offered) pick.append(new Option(value, value));
      pick.value = now.value || '';
      box.append(el('label', { className: 'field' },
        el('span', { textContent: `${label}${now.source === 'matched' ? ' (matched from the list)' : ''}` }),
        pick));
    }
  }

  $('resign-map-save').addEventListener('click', async () => {
    const asked = {};
    for (const [key] of OUTCOMES) {
      const value = $(`resign-map-${key}`) && $(`resign-map-${key}`).value;
      if (value && value !== STATUSES[key].value) asked[key] = value;
      if (value && STATUSES[key].source === 'matched' && value === STATUSES[key].value) asked[key] = value;
    }
    if (!Object.keys(asked).length) { say('resign-map-line', 'Nothing to change.'); return; }
    try {
      STATUSES = await reg.api('/api/resign-statuses', { method: 'PUT', body: JSON.stringify(asked) });
      drawSettings();
      say('resign-map-line', 'Saved. The change log has it.', 'good');
      window.dispatchEvent(new CustomEvent('assets-changed'));
      reg.refreshLog();
    } catch (error) {
      say('resign-map-line', error.message, 'bad');
    }
  });

  /* ---------- start ---------- */

  window.addEventListener('register-ready', () => {
    reg = window.register;
    if (!reg.session || !reg.canEdit()) return;
    reg.openResign = openResign;
    reg.reloadAttention = reloadAttention;
  });

  window.addEventListener('assets-loaded', () => {
    if (!reg || !reg.canEdit()) return;
    reloadAttention();
    drawSettings();
  });
})();
