import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

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

const { db, listHolders, getHolder, listFleet, listDevices, updateHolder, listAudit } =
  await import('./db.mjs');
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

app.get('/api/session', (req, res) => res.json(req.session || { role: null }));

/* For container and load-balancer health checks: no session, no database. */
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

/* ---------- the register ---------- */

app.get('/api/holders', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json({ holders: listHolders(), fleet: listFleet() });
});

app.get('/api/holders/:id/devices', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json(listDevices(req.params.id));
});

const TYPES = ['Sales', 'HO', 'Unknown'];

app.patch('/api/holders/:id', requireRole('admin', 'editor'), (req, res) => {
  const patch = {};
  if ('type' in req.body) {
    if (!TYPES.includes(req.body.type)) {
      return res.status(400).json({ error: `Type must be one of ${TYPES.join(', ')}.` });
    }
    patch.type = req.body.type;
  }
  if ('resigned' in req.body) patch.resigned = Boolean(req.body.resigned);
  if ('note' in req.body) patch.note = String(req.body.note ?? '').slice(0, 500);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change.' });

  const row = updateHolder(req.params.id, patch, req.session.label);
  if (!row) return res.status(404).json({ error: 'No such holder.' });
  res.json(row);
});

app.get('/api/export.csv', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  const withContact = req.session.role === 'admin';
  const columns = [
    ['name', 'Holder'], ['type', 'Type'], ['resigned', 'Resigned'], ['status', 'Device'],
    ['n', 'Units'], ['nL', 'Laptops'], ['nI', 'iPads'], ['position', 'Position'],
    ['department', 'Department'], ['unit', 'Unit'],
    ...(withContact ? [['ad_id', 'Network ID'], ['email', 'Email']] : []),
    ['lap', 'Laptop serial'], ['lapM', 'Laptop model'],
    ['ipd', 'iPad serial'], ['ipdM', 'iPad model'],
    ['rem', 'Inventory remark'], ['note', 'Note'], ['src', 'Type source'],
    ['hr_status', 'On the HR list'],
  ];
  const escape = (value) => {
    const text = value === true ? 'Yes' : value === false ? '' : String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = listHolders().map((row) => columns.map(([key]) => escape(row[key])).join(','));
  res.type('text/csv').attachment('device-holders.csv');
  res.send([columns.map(([, head]) => head).join(','), ...body].join('\r\n'));
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
