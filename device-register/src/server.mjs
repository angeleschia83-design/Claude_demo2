import express from 'express';
import XLSX from 'xlsx';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

/* A tiny .env reader, so the app needs no dependency just to start. */
const envFile = path.join(here, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const { db, listHolders, getHolder, listFleet, listDevices, updateHolder, listAudit,
        editableFields, listSummary } = await import('./db.mjs');
const { sessions, requireRole, makeSession, checkAdminPassword, cookieName, cookieOptions, newToken } =
  await import('./auth.mjs');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(sessions);

/* ---------- signing in ---------- */

app.post('/api/login', (req, res) => {
  if (!checkAdminPassword(req.body?.password)) {
    return res.status(401).json({ error: 'That password is not right.' });
  }
  res.cookie(cookieName, makeSession('admin', 'IT admin'), cookieOptions());
  res.json({ role: 'admin', label: 'IT admin' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(cookieName, { path: '/' });
  res.json({ ok: true });
});

/* An invite link: opening it grants that link's role, then lands on the page. */
app.get('/i/:token', (req, res) => {
  const invite = db.prepare('SELECT * FROM invites WHERE token = ? AND revoked = 0').get(req.params.token);
  if (!invite) return res.status(404).sendFile(path.join(here, '..', 'public', 'invalid.html'));
  db.prepare('UPDATE invites SET last_used = ? WHERE token = ?').run(new Date().toISOString(), invite.token);
  res.cookie(cookieName, makeSession(invite.role, invite.label), cookieOptions());
  res.redirect('/');
});

/* The addresses other machines on the network can reach this one by. The
   page builds invite links from these rather than from whatever is in the
   admin's address bar, which is usually localhost and useless to anybody
   else. */
const networkAddresses = () => {
  const port = Number(process.env.PORT) || 3000;
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((face) => face && face.family === 'IPv4' && !face.internal)
    .map((face) => `http://${face.address}:${port}`);
};

app.get('/api/session', (req, res) =>
  res.json({
    ...(req.session || { role: null }),
    addresses: networkAddresses(),
    version: VERSION,
    fields: editableFields,
  }));

/* For container and load-balancer health checks: no session, no database. */
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

/* ---------- the register ---------- */

app.get('/api/holders', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json({ holders: listHolders(), fleet: listFleet() });
});

app.get('/api/holders/:id/devices', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json(listDevices(req.params.id));
});

/* Every asset, counted by type, status, model and age. Nothing is filtered
   or named in advance, so a new model or status arrives on its own. */
app.get('/api/summary', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json(listSummary());
});

const TYPES = ['Sales', 'HO', 'Unknown'];
const EDITABLE = new Set(editableFields.map((field) => field.key));

app.patch('/api/holders/:id', requireRole('admin', 'editor'), (req, res) => {
  const patch = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!EDITABLE.has(key)) continue;
    /* null is how the page asks for the workbook's value back. */
    if (value === null) { patch[key] = null; continue; }
    if (key === 'type') {
      if (!TYPES.includes(value)) {
        return res.status(400).json({ error: `Type must be one of ${TYPES.join(', ')}.` });
      }
      patch[key] = value;
    } else if (key === 'resigned') {
      patch[key] = Boolean(value);
    } else {
      patch[key] = String(value ?? '').trim().slice(0, 500);
    }
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Nothing here can be changed.' });
  }

  const row = updateHolder(req.params.id, patch, req.session.label);
  if (!row) return res.status(404).json({ error: 'No such holder.' });
  res.json(row);
});

/* Only the admin export carries contact details. */
const exportColumns = (role) => {
  const withContact = role === 'admin';
  return [
    ['name', 'Holder'], ['type', 'Type'], ['resigned', 'Resigned'], ['status', 'Device'],
    ['n', 'Units'], ['nL', 'Laptops'], ['nI', 'iPads'], ['position', 'Position'],
    ['department', 'Department'], ['unit', 'Unit'],
    ...(withContact ? [['ad_id', 'Network ID'], ['email', 'Email']] : []),
    ['lap', 'Laptop serial'], ['lapM', 'Laptop model'],
    ['ipd', 'iPad serial'], ['ipdM', 'iPad model'],
    ['rem', 'Inventory remark'], ['note', 'Note'], ['src', 'Type source'],
    ['hr_status', 'On the HR list'],
    ['lwd', 'Last working day'],
    ['changedList', 'Corrected here'],
  ];
};

const exportValue = (row, key) => {
  if (key === 'resigned') return row.resigned ? 'Yes' : '';
  if (key === 'type') return row.type === 'Unknown' ? 'No type' : row.type;
  if (key === 'changedList') return (row.changed || []).join(', ');
  return row[key] ?? '';
};

app.get('/api/export.csv', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  const columns = exportColumns(req.session.role);
  const escape = (value) => {
    const text = value === true ? 'Yes' : value === false ? '' : String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = listHolders().map((row) => columns.map(([key]) => escape(exportValue(row, key))).join(','));
  res.type('text/csv').attachment('device-holders.csv');
  res.send([columns.map(([, head]) => head).join(','), ...body].join('\r\n'));
});

app.get('/api/export.xlsx', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  const columns = exportColumns(req.session.role);
  const rows = listHolders();
  const shape = (list) => list.map((row) =>
    Object.fromEntries(columns.map(([key, head]) => [head, exportValue(row, key)])));

  const book = XLSX.utils.book_new();
  const widths = columns.map(([key]) =>
    ({ wch: ['name', 'position', 'department'].includes(key) ? 28 : key === 'rem' ? 26 : 14 }));

  const main = XLSX.utils.json_to_sheet(shape(rows));
  main['!cols'] = widths;
  main['!autofilter'] = { ref: main['!ref'] };
  XLSX.utils.book_append_sheet(book, main, 'Holders');

  const leavers = rows.filter((row) => row.resigned);
  if (leavers.length) {
    const sheet = XLSX.utils.json_to_sheet(shape(leavers));
    sheet['!cols'] = widths;
    XLSX.utils.book_append_sheet(book, sheet, 'To retrieve');
  }

  const counts = new Map();
  for (const row of rows) {
    const key = row.type === 'Unknown' ? 'No type' : row.type;
    const entry = counts.get(key)
      || { Type: key, People: 0, Laptops: 0, iPads: 0, Units: 0, Resigned: 0 };
    entry.People += 1;
    entry.Laptops += row.nL;
    entry.iPads += row.nI;
    entry.Units += row.n;
    if (row.resigned) entry.Resigned += 1;
    counts.set(key, entry);
  }
  const summary = XLSX.utils.json_to_sheet([...counts.values()]);
  summary['!cols'] = [{ wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(book, summary, 'Summary');

  /* The asset summary the spreadsheet used to hold, counted from the rows so
     a new model or status cannot be dropped. */
  const asset = listSummary();
  const pivot = (source, down, across, firstLabel) => {
    const downs = [...new Set(source.map((r) => r[down]))].sort();
    const acrosses = [...new Set(source.map((r) => r[across]))].sort();
    const at = new Map();
    for (const r of source) {
      const key = `${r[down]}\u0000${r[across]}`;
      at.set(key, (at.get(key) || 0) + r.n);
    }
    return downs.map((d) => {
      const line = { [firstLabel]: d };
      let total = 0;
      for (const a of acrosses) {
        const v = at.get(`${d}\u0000${a}`) || 0;
        line[a] = v || '';
        total += v;
      }
      line.Total = total;
      return line;
    });
  };

  const byType = XLSX.utils.json_to_sheet(pivot(asset.rows, 'type', 'status', 'Asset type'));
  byType['!cols'] = [{ wch: 22 }, ...Array(10).fill({ wch: 13 })];
  XLSX.utils.book_append_sheet(book, byType, 'Assets by type');

  const byModel = XLSX.utils.json_to_sheet(
    pivot(asset.rows.filter((r) => r.type === 'Laptop' || r.type === 'iPad' || r.type === 'Imac'),
          'model', 'status', 'Model'));
  byModel['!cols'] = [{ wch: 22 }, ...Array(10).fill({ wch: 13 })];
  XLSX.utils.book_append_sheet(book, byModel, 'Laptops and iPads by model');

  const byAge = XLSX.utils.json_to_sheet(pivot(asset.rows, 'type', 'age', 'Asset type'));
  byAge['!cols'] = [{ wch: 22 }, ...Array(4).fill({ wch: 16 })];
  XLSX.utils.book_append_sheet(book, byAge, 'Asset age');

  if (asset.duplicates.length) {
    const dupes = XLSX.utils.json_to_sheet(asset.duplicates.map((d) => ({
      Serial: d.serial, 'Asset type': d.asset_type, Model: d.model,
      'Listed as': d.statuses.join(' / '), 'Assigned to': d.holder,
      Note: 'One serial is one piece of hardware, so this is counted once.',
    })));
    dupes['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 30 }, { wch: 22 }, { wch: 58 }];
    XLSX.utils.book_append_sheet(book, dupes, 'Duplicate serials');
  }

  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment('device-holders.xlsx');
  res.send(XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }));
});

/* ---------- admin only ---------- */

app.get('/api/invites', requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM invites ORDER BY created_at DESC').all());
});

app.post('/api/invites', requireRole('admin'), (req, res) => {
  const label = String(req.body?.label ?? '').trim().slice(0, 80);
  const role = req.body?.role === 'editor' ? 'editor' : 'viewer';
  if (!label) return res.status(400).json({ error: 'Give the link a name, so you know who it went to.' });
  const token = newToken();
  db.prepare('INSERT INTO invites (token, label, role, created_at) VALUES (?, ?, ?, ?)')
    .run(token, label, role, new Date().toISOString());
  res.status(201).json({ token, label, role });
});

app.post('/api/invites/:token/revoke', requireRole('admin'), (req, res) => {
  db.prepare('UPDATE invites SET revoked = 1 WHERE token = ?').run(req.params.token);
  res.json({ ok: true });
});

app.get('/api/audit', requireRole('admin'), (req, res) => res.json(listAudit(300)));

/* ---------- the page ---------- */

app.use(express.static(path.join(here, '..', 'public'), { index: 'index.html', maxAge: '1h' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM holders').get().n;
  if (!count) console.warn('The register is empty. Run `npm run import` first.');
  console.log(`Device register on http://localhost:${port} (${count} holders)`);
});
