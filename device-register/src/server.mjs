import express from 'express';
import zlib from 'node:zlib';
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
      /* Trim first: trailing spaces survive the capture, and `SECURE_COOKIES=1 `
         is not `1`, so the session cookie would ship without Secure and say
         nothing about it. */
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const { db, listHolders, listFleet, listDevices, updateHolder, listAudit,
        editableFields, listSummary, listProblems, countAudit, lastAuditId,
        getNote, setNote, recordChange, getHolder, stampTicket } = await import('./db.mjs');
const { sessions, requireRole, makeSession, checkAdminPassword, cookieName, cookieOptions, newToken,
        adminStamp, setAdminPassword, isPlaceholderPassword } = await import('./auth.mjs');
const { parseChanges, planChanges, patchesFor } = await import('./merge.mjs');
const { writeWorkbook } = await import('./xlsx.mjs');
const assets = await import('./assets.mjs');
const reconcile = await import('./reconcile.mjs');
const resign = await import('./resign.mjs');
const backup = await import('./backup.mjs');

/* The words a person may pick from are seeded once, from whatever the
   workbook already used. */
assets.seedLists();

const app = express();
app.disable('x-powered-by');

/* Behind a reverse proxy every request arrives from the proxy, so the
   lockout below would count the whole company as one address. Set
   TRUST_PROXY=1 only when there really is a proxy in front: trusting the
   header when there is not lets a caller claim any address it likes. */
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

/* The page loads nothing from anywhere else: no fonts, no scripts, no
   analytics, no frames. Saying so in a header means a browser enforces it
   even if a later edit forgets. */
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  /* Only where TLS is actually terminated in front of this. Sending it over
     plain http would pin a promise the deployment has not made. */
  if (process.env.SECURE_COOKIES === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

/* Three routes take a pasted block and need a larger body. Mounting a second
   express.json() on the route itself cannot do that: body-parser skips any
   later parser once req._body is set, so the limit has to be chosen here. */
const BIG_BODY = new Set(['/api/merge/preview', '/api/merge/apply', '/api/workbook/apply']);
const smallBody = express.json({ limit: '64kb' });
const bigBody = express.json({ limit: '2mb' });
app.use((req, res, next) => (BIG_BODY.has(req.path) ? bigBody : smallBody)(req, res, next));
app.use(sessions);

/* The asset and holder lists run to hundreds of kilobytes of JSON, and the
   page asks for them again after a change. Over the office network that was
   the delay people felt; gzipped they are a tenth of the size. */
app.use((req, res, next) => {
  if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
  const send = res.json.bind(res);
  res.json = (body) => {
    const text = JSON.stringify(body);
    if (text === undefined || text.length < 2048) return send(body);
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    return res.send(zlib.gzipSync(text));
  };
  next();
});

/* A session minted by an invite link is only as good as that link. Re-reading
   the row on every request is what makes Revoke mean what the page says it
   means; without it a withdrawn link kept working for up to fourteen days. */
const liveInvite = db.prepare('SELECT revoked FROM invites WHERE token = ?');
app.use((req, res, next) => {
  const token = req.session && req.session.invite;
  if (token && token !== '-') {
    /* `~` marks an admin session, which carries a stamp of the password it
       was issued under rather than an invite token. */
    if (token.startsWith('~')) {
      if (token !== adminStamp()) req.session = null;
    } else {
      const row = liveInvite.get(token);
      if (!row || row.revoked) req.session = null;
    }
  }
  next();
});

/* ---------- signing in ---------- */

/* One password guarded by nothing is a password somebody can guess at
   leisure. Five wrong tries from one address and that address waits, with
   the wait growing each time; a right one clears it. Kept in memory on
   purpose: a restart is not a way around it, because a restart means
   somebody with access to the server, who has easier paths than this. */
const attempts = new Map();
const LOCK_AFTER = 5;

const lockedFor = (who) => {
  const seen = attempts.get(who);
  if (!seen || seen.count < LOCK_AFTER) return 0;
  const wait = Math.min(2 ** (seen.count - LOCK_AFTER) * 15000, 15 * 60000);
  return Math.max(0, seen.at + wait - Date.now());
};

app.post('/api/login', (req, res) => {
  const who = req.ip || 'unknown';
  const wait = lockedFor(who);
  if (wait > 0) {
    res.setHeader('Retry-After', Math.ceil(wait / 1000));
    return res.status(429).json({
      error: `Too many wrong passwords. Try again in ${Math.ceil(wait / 1000)} seconds.`,
    });
  }
  if (!checkAdminPassword(req.body?.password)) {
    const seen = attempts.get(who) || { count: 0 };
    attempts.set(who, { count: seen.count + 1, at: Date.now() });
    return res.status(401).json({ error: 'That password is not right.' });
  }
  attempts.delete(who);
  /* Everyone with the password signs in as the same person, so the change log
     cannot tell two admins apart. A name typed at sign-in is not proof of
     anything, but it is the difference between a log that names somebody and
     one that names nobody. */
  const named = String(req.body?.who ?? '').replace(/[^\w .-]/g, '').trim().slice(0, 40);
  const label = named ? `IT admin (${named})` : 'IT admin';
  res.cookie(cookieName, makeSession('admin', label, adminStamp()), cookieOptions());
  res.json({ role: 'admin', label });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(cookieName, { path: '/' });
  res.json({ ok: true });
});

/* An invite link: opening it grants that link's role, then lands on the page. */
app.get('/i/:token', (req, res) => {
  const invite = db.prepare('SELECT * FROM invites WHERE token = ? AND revoked = 0').get(req.params.token);
  if (!invite) {
    return res.status(404).sendFile(path.join(here, '..', 'public', 'invalid.html'),
      { headers: { 'Cache-Control': 'no-cache' } });
  }
  db.prepare('UPDATE invites SET last_used = ? WHERE token = ?').run(new Date().toISOString(), invite.token);
  res.cookie(cookieName, makeSession(invite.role, invite.label, invite.token), cookieOptions());
  res.redirect('/');
});

/* The addresses other machines on the network can reach this one by. The
   page builds invite links from these rather than from whatever is in the
   admin's address bar, which is usually localhost and useless to anybody
   else. */
const networkAddresses = () => {
  /* On a server the machine's own addresses are the wrong answer: people
     reach it by a hostname, through a proxy, on 443. PUBLIC_URL is that
     address, and when it is set the links are built from it and nothing
     else — a link carrying 10.80.103.201 is a link nobody outside the
     office can open. */
  const announced = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (announced) return [announced];

  const port = Number(process.env.PORT) || 3000;
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((face) => face && face.family === 'IPv4' && !face.internal)
    .map((face) => `http://${face.address}:${port}`);
};

app.get('/api/session', (req, res) => {
  const role = req.session ? req.session.role : null;
  if (role) {
    try { backup.backupIfDue(); } catch (error) {
      console.error(`[${new Date().toISOString()}] The weekly backup failed: ${error.message}`);
    }
  }
  res.json({
    ...(req.session || { role: null }),
    /* Only the admin builds invite links, so only the admin needs the
       machine's own network addresses — and nobody at all needs them before
       signing in, which is what this route used to hand out. */
    addresses: role === 'admin' ? networkAddresses() : [],
    /* Whether that address was configured or guessed from the machine's own
       network interfaces, so the page can say the right thing about it. */
    announced: role === 'admin' && Boolean(String(process.env.PUBLIC_URL || '').trim()),
    version: role ? VERSION : '',
    fields: editableFields,
    /* When the register was last backed up, for the bar at the top: the
       people who change things are the ones who should see it go stale. */
    ...(role === 'admin' || role === 'editor' ? { lastBackup: backup.lastBackupAt() } : {}),
  });
});

/* ---------- backups ---------- */

/* Admin only: a backup is every record, contact details included. */
app.get('/api/backups', requireRole('admin'), (req, res) => {
  res.json(backup.listBackups());
});

app.post('/api/backups', requireRole('admin'), (req, res) => {
  try {
    res.json(backup.makeBackup(req.session.label));
  } catch (error) {
    res.status(500).json({ error: `The backup could not be made: ${error.message}` });
  }
});

app.get('/api/backups/:file', requireRole('admin'), (req, res) => {
  const full = backup.backupPath(req.params.file);
  if (!full) return res.status(404).json({ error: 'There is no backup by that name.' });
  res.download(full, req.params.file);
});

/* For container and load-balancer health checks: no session, no database. */
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

/* ---------- the register ---------- */

/* Only the admin export carries contact details, so only an admin should get
   them from the API. Handing them to every role made that withholding
   cosmetic: the page never drew them, but one direct call returned the lot. */
const CONTACT = ['ad_id', 'email'];
const withoutContact = (rows, role) => (role === 'admin' ? rows : rows.map((row) => {
  const out = { ...row };
  for (const key of CONTACT) delete out[key];
  if (out.base) {
    out.base = { ...out.base };
    for (const key of CONTACT) delete out.base[key];
  }
  return out;
}));

app.get('/api/holders', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json({ holders: withoutContact(listHolders(), req.session.role), fleet: listFleet() });
});

app.get('/api/holders/:id/devices', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json(listDevices(req.params.id));
});

/* Every asset, counted by type, status, model and age. Nothing is filtered
   or named in advance, so a new model or status arrives on its own. */
app.get('/api/summary', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json(listSummary());
});

/* Changes an auditor would ask about carry a ticket number: custody, an
   asset's identity or status, a record added or removed, somebody resigned.
   Refused here without one, whatever the page sends, and stamped on every
   change-log line the change writes. Fixing a spelling does not need one. */
const NEED_TICKET = 'A ticket number is needed for this change, so it can be looked up later.';
const ticketOf = (req) => String(req.body?.ticket ?? '').trim().slice(0, 60);
const requireTicket = (req, res) => {
  const ticket = ticketOf(req);
  if (!ticket) res.status(400).json({ error: NEED_TICKET, needTicket: true });
  return ticket;
};

const TYPES = ['Sales', 'HO', 'Unknown'];
const EDITABLE = new Set(editableFields.map((field) => field.key));

app.patch('/api/holders/:id', requireRole('admin', 'editor'), (req, res) => {
  const current = getHolder(req.params.id);
  if (!current) return res.status(404).json({ error: 'No such holder.' });
  /* Somebody who has left is a closed record: an editor link can still get
     their hardware back, but only an admin changes the person. */
  if (current.resigned && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'This person is resigned: only an admin can change their details.' });
  }
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

  let row;
  if ('resigned' in patch) {
    const ticket = requireTicket(req, res);
    if (!ticket) return;
    row = stampTicket(ticket, () => updateHolder(req.params.id, patch, req.session.label, ticket));
  } else {
    row = updateHolder(req.params.id, patch, req.session.label);
  }
  if (!row) return res.status(404).json({ error: 'No such holder.' });
  res.json(withoutContact([row], req.session.role)[0]);
});

/* Ticking somebody resigned, and saying for each piece of hardware on their
   name what happens to it. All of it is saved or none of it is. */
app.post('/api/holders/:id/resign', requireRole('admin', 'editor'), (req, res) => {
  const body = req.body || {};
  const ticket = requireTicket(req, res);
  if (!ticket) return;
  try {
    const out = stampTicket(ticket, () => resign.resignHolder(req.params.id, {
      choices: Array.isArray(body.choices) ? body.choices : [],
      ticket,
      note: String(body.note ?? '').trim().slice(0, 500),
      later: body.later === true,
    }, req.session.label));
    if (out.error) return res.status(out.code).json({ error: out.error });
    res.json({ holder: withoutContact([out.holder], req.session.role)[0], assets: out.assets });
  } catch (error) { assetError(res, error); }
});

/* A paste or a pick-list can be long, so these routes take a larger body than
   the rest — chosen at the top beside the global parser, for the reason given
   there. This stays as a no-op so the route list still reads the same. */
const mergeBody = (req, res, next) => next();

/* ---------- the assets themselves ---------- */

/* An asset is corrected the same way a holder is: the workbook's row is the
   base, what is set here wins, and an import leaves it alone. */
const assetError = (res, error) => res.status(400).json({ error: error.message || String(error) });
/* A near miss on adding: nothing is written, and the page shows the likely
   match with Add anyway, which sends confirm. */
const LOOKS_LIKE = 'This looks like something already in the register. Check it is not the same before adding it.';

app.get('/api/assets', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json({ assets: assets.listAssets(), lists: assets.allLists(), fields: assets.assetFields });
});

app.post('/api/assets', requireRole('admin', 'editor'), (req, res) => {
  const ticket = requireTicket(req, res);
  if (!ticket) return;
  try {
    const out = stampTicket(ticket, () => assets.addAsset(req.body || {}, req.session.label));
    if (out.possibleDuplicates) return res.status(409).json({ ...out, error: LOOKS_LIKE });
    res.json(out);
  } catch (error) { assetError(res, error); }
});

app.patch('/api/assets/:serial', requireRole('admin', 'editor'), (req, res) => {
  const { ticket: given, ...body } = req.body || {};
  /* Its status and its serial are what an audit follows; a remark is not. */
  const audited = 'status' in body || typeof body.serial === 'string';
  const ticket = audited ? requireTicket(req, res) : '';
  if (audited && !ticket) return;
  const run = (fn) => (audited ? stampTicket(ticket, fn) : fn());
  try {
    /* A serial is the asset's identity rather than one of its fields, so
       changing it moves the row and everything logged against it. */
    if (typeof body.serial === 'string') {
      const row = run(() => {
        const moved = assets.renameAsset(req.params.serial, body.serial, req.session.label);
        if (!moved) return null;
        const { serial, ...rest } = body;
        return Object.keys(rest).length ? assets.updateAsset(moved.serial, rest, req.session.label) : moved;
      });
      if (!row) return res.status(404).json({ error: 'No asset with that serial.' });
      return res.json(row);
    }
    const row = run(() => assets.updateAsset(req.params.serial, body, req.session.label));
    if (!row) return res.status(404).json({ error: 'No asset with that serial.' });
    res.json(row);
  } catch (error) { assetError(res, error); }
});

/* Handing hardware out. Anything that is usually a mistake stops here and
   asks for a ticket number, which is then recorded against the change. */
app.post('/api/assets/:serial/assign', requireRole('admin', 'editor'), (req, res) => {
  const ticket = ticketOf(req);
  /* Without a ticket nothing is written, but the answer says what the
     hand-out would run into, so the page can warn before it goes ahead. */
  if (!ticket) {
    const seen = assets.previewAssign(req.params.serial, String(req.body?.holder_id || ''));
    if (seen.error) return res.status(404).json({ error: seen.error });
    return res.status(409).json({ error: NEED_TICKET, needTicket: true, reasons: seen.reasons });
  }
  try {
    const out = stampTicket(ticket, () => assets.assignAsset(req.params.serial, String(req.body?.holder_id || ''), {
      actor: req.session.label,
      ticket,
    }));
    if (out.error) return res.status(404).json({ error: out.error });
    if (out.needTicket) {
      return res.status(409).json({
        needTicket: true,
        reasons: out.reasons,
        asset: out.asset,
        holder: { id: out.holder.id, name: out.holder.name },
      });
    }
    res.json({ ...out, holder: withoutContact([out.holder], req.session.role)[0] });
  } catch (error) { assetError(res, error); }
});

app.post('/api/assets/:serial/return', requireRole('admin', 'editor'), (req, res) => {
  const ticket = requireTicket(req, res);
  if (!ticket) return;
  try {
    const out = stampTicket(ticket, () => assets.returnAsset(req.params.serial, {
      actor: req.session.label,
      status: req.body?.status,
      ticket,
    }));
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (error) { assetError(res, error); }
});

/* An asset that should not be on the register. Editors can take one off;
   deleting outright is an admin's, and only for something typed in here. */
app.post('/api/assets/:serial/remove', requireRole('admin', 'editor'), (req, res) => {
  const ticket = requireTicket(req, res);
  if (!ticket) return;
  const out = stampTicket(ticket, () => assets.removeAsset(req.params.serial, {
    actor: req.session.label,
    reason: req.body?.reason,
    hard: Boolean(req.body?.hard) && req.session.role === 'admin',
  }));
  if (out.error) return res.status(400).json(out);
  res.json({ ...out, holders: withoutContact(listHolders(), req.session.role), fleet: listFleet() });
});

app.post('/api/assets/:serial/restore', requireRole('admin'), (req, res) => {
  const ticket = requireTicket(req, res);
  if (!ticket) return;
  const out = stampTicket(ticket, () => assets.restoreAsset(req.params.serial, req.session.label));
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.get('/api/assets/removed', requireRole('admin', 'editor'), (req, res) =>
  res.json(assets.listRemovedAssets()));

/* ---------- somebody who joined between workbooks ---------- */

app.post('/api/holders', requireRole('admin', 'editor'), (req, res) => {
  const ticket = requireTicket(req, res);
  if (!ticket) return;
  try {
    const out = stampTicket(ticket, () => assets.addHolder(req.body || {}, req.session.label));
    if (out.possibleDuplicates) return res.status(409).json({ ...out, error: LOOKS_LIKE });
    res.json(withoutContact([out], req.session.role)[0]);
  } catch (error) { assetError(res, error); }
});

/* ---------- the words people may pick from ---------- */

app.get('/api/lists', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json(assets.allLists());
});

app.post('/api/lists/:kind', requireRole('admin', 'editor'), (req, res) => {
  try {
    res.json(assets.addValue(req.params.kind, req.body?.value, req.session.label));
  } catch (error) { assetError(res, error); }
});

app.delete('/api/lists/:kind/:value', requireRole('admin'), (req, res) => {
  const ticket = requireTicket(req, res);
  if (!ticket) return;
  try {
    res.json(stampTicket(ticket, () => assets.deleteValue(req.params.kind, req.params.value, req.session.label)));
  } catch (error) { assetError(res, error); }
});

app.patch('/api/lists/:kind/:value', requireRole('admin'), (req, res) => {
  try {
    res.json(assets.setValueFlag(req.params.kind, req.params.value, req.body || {}, req.session.label));
  } catch (error) { assetError(res, error); }
});

/* Which status each of the four resign choices writes. Every role may read
   it: it is words from the status list, which every role already sees. */
app.get('/api/resign-statuses', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json(resign.resignStatuses());
});

app.put('/api/resign-statuses', requireRole('admin'), (req, res) => {
  try {
    res.json(resign.setResignStatuses(req.body || {}, req.session.label));
  } catch (error) { assetError(res, error); }
});

/* Whether anything has changed, for every role: the newest change-log
   line's number and nothing else. An open page asks this every half minute
   and reloads only when it moves, which is how one person sees another's
   change without pressing refresh. */
app.get('/api/changed', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ last: lastAuditId() });
});

/* The hardware waiting to come back, and since when. Only reads. */
app.get('/api/retrieve', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  res.json(resign.listToRetrieve());
});

/* Something waiting to come back has come back. */
app.post('/api/retrieve/:serial/back', requireRole('admin', 'editor'), (req, res) => {
  const ticket = requireTicket(req, res);
  if (!ticket) return;
  try {
    const out = stampTicket(ticket, () => resign.bringBack(req.params.serial, String(req.body?.outcome || ''), req.session.label));
    if (out.error) return res.status(out.code).json({ error: out.error });
    res.json(out);
  } catch (error) { assetError(res, error); }
});

/* ---------- one person entered twice ---------- */

/* The workbook names people by whatever was typed into it, so the same
   person typed two ways is two holders with some hardware each. Folding one
   into the other moves the hardware, keeps what only the folded record
   knew, and survives the next import — which is why it is offered ahead of
   deleting. */
app.post('/api/holders/:id/merge', requireRole('admin', 'editor'), (req, res) => {
  const out = assets.mergeHolders(req.params.id, String(req.body?.into || ''), req.session.label);
  if (out.error) return res.status(400).json(out);
  res.json({ ...out, keeper: withoutContact([out.keeper], req.session.role)[0], holders: withoutContact(listHolders(), req.session.role), fleet: listFleet() });
});

/* Every proposed pair in one go. The register picks which record to keep
   from how each name matched HR's own list, says so for each one, and each
   fold can be put back on its own. */
app.post('/api/holders/fold-all', requireRole('admin'), (req, res) => {
  const settled = new Set(getNote('not_duplicates') || []);
  const pairs = listProblems().duplicatePeople.filter((pair) => !settled.has(pair.key));
  /* Every other mutating holder route answers with the register, and the page
     assigns from that answer unconditionally. Leaving it out here handed the
     page undefined and broke every later redraw until a reload. */
  if (!pairs.length) {
    return res.json({ report: [], folded: 0,
      holders: withoutContact(listHolders(), req.session.role), fleet: listFleet() });
  }
  const out = assets.foldAll(req.session.label, { pairs });
  res.json({ ...out, holders: withoutContact(listHolders(), req.session.role), fleet: listFleet() });
});

app.post('/api/holders/:id/unmerge', requireRole('admin'), (req, res) => {
  const out = assets.unmergeHolders(req.params.id, req.session.label);
  if (out.error) return res.status(400).json(out);
  res.json({ ...out, holders: withoutContact(listHolders(), req.session.role), fleet: listFleet() });
});

app.get('/api/merged', requireRole('admin', 'editor'), (req, res) => res.json(assets.listMerged()));

/* Two people who happen to have near enough the same name. Saying so once
   stops the register asking again. */
app.post('/api/not-duplicates', requireRole('admin', 'editor'), (req, res) => {
  const key = String(req.body?.key || '').slice(0, 80);
  if (!key) return res.status(400).json({ error: 'Which pair?' });
  /* Read and write in one transaction. Each caller used to write back the
     whole set it had read, so two editors clicking at once lost one of the
     two decisions. The cap stops one notes row growing without end. */
  let settled = [];
  db.transaction(() => {
    const now = new Set(getNote('not_duplicates') || []);
    if (req.body?.undo) now.delete(key);
    else if (now.size < 5000) now.add(key);
    setNote('not_duplicates', [...now]);
    settled = [...now];
  })();
  res.json({ settled });
});

app.delete('/api/holders/:id', requireRole('admin'), (req, res) => {
  const ticket = requireTicket(req, res);
  if (!ticket) return;
  const out = stampTicket(ticket, () => assets.deleteHolder(req.params.id, req.session.label));
  if (out.error) return res.status(400).json(out);
  res.json({ ...out, holders: withoutContact(listHolders(), req.session.role), fleet: listFleet() });
});

/* ---------- a new workbook, waiting to be looked at ---------- */

app.get('/api/workbook', requireRole('admin'), (req, res) => {
  res.json(reconcile.reconcilePlan() || { waiting: false });
});

app.post('/api/workbook/apply', requireRole('admin'), mergeBody, (req, res) => {
  const out = reconcile.applyPlan(req.body?.picked, req.session.label, req.body?.seen);
  if (out.error) return res.status(400).json(out);
  res.json({ ...out, plan: reconcile.reconcilePlan(), holders: withoutContact(listHolders(), req.session.role), fleet: listFleet() });
});

app.post('/api/workbook/discard', requireRole('admin'), (req, res) => {
  reconcile.clearStage();
  res.json({ waiting: false });
});

/* ---------- changes handed back from the offline copy ---------- */

/* Somebody outside the office works in the offline HTML copy and sends back
   a block of text. It is read, shown as a list of before-and-afters, and
   only then applied — and only the lines that are ticked. */
const planFromBody = (req) =>
  planChanges(parseChanges(req.body?.text), listHolders(), assets.listAssets());

app.post('/api/merge/preview', requireRole('admin', 'editor'), mergeBody, (req, res) => {
  try {
    res.json(planFromBody(req));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/merge/apply', requireRole('admin', 'editor'), mergeBody, (req, res) => {
  let plan;
  try {
    plan = planFromBody(req);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const picked = Array.isArray(req.body?.picked)
    ? req.body.picked
    : plan.rows.filter((row) => row.state === 'change').map((row) => row.key);
  const patches = patchesFor(plan, picked);
  if (!patches.holders.length && !patches.assets.length) {
    return res.status(400).json({ error: 'Nothing was ticked, so nothing was merged.' });
  }
  /* A paste can resign somebody or change an asset's status, so it needs a
     ticket like every other audited change, and it goes through the same
     leaver lock as editing a row by hand. */
  const ticket = requireTicket(req, res);
  if (!ticket) return;

  /* The change log names both of them: whoever made the correction, and
     whoever let it in. */
  /* plan.from is whatever the pasted file claims to be, so it is recorded as
     a claim beside the person who let it in, rather than written into the log
     as an identity of its own. */
  const claimed = String(plan.from || '').replace(/[^\w .@-]/g, '').trim().slice(0, 60);
  const actor = `${req.session.label} (from a copy marked "${claimed || 'unnamed'}")`.slice(0, 120);

  /* One transaction. Each write used to be its own, so a failure halfway left
     the earlier ones committed with nothing saying which had landed. */
  const rejected = [];
  let people = 0;
  let fields = 0;
  let things = 0;
  stampTicket(ticket, () => {
    for (const { id, patch } of patches.holders) {
      const current = getHolder(id);
      if (current && current.resigned && req.session.role !== 'admin') {
        rejected.push({ serial: current.name, why: 'resigned: only an admin can change their details' });
        continue;
      }
      if (!updateHolder(id, patch, actor)) continue;
      people += 1;
      fields += Object.keys(patch).length;
    }
    for (const { serial, patch } of patches.assets) {
      try {
        if (!assets.updateAsset(serial, patch, actor)) continue;
      } catch (error) {
        /* A word the register does not know is reported rather than written —
           which until now meant reported nowhere at all. */
        rejected.push({ serial, why: error.message });
        continue;
      }
      things += 1;
      fields += Object.keys(patch).length;
    }
  });

  res.json({ people, assets: things, fields, rejected, from: plan.from,
    holders: withoutContact(listHolders(), req.session.role), fleet: listFleet() });
});

/* A cell beginning = + - @ or a control character is a formula to Excel, and
   the people who can type one into a note are outside the company by design.
   The .xlsx export is unaffected: it writes its cells as inlineStr. */
const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

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
  const escape = (value) =>
    csvCell(value === true ? 'Yes' : value === false ? '' : String(value ?? ''));
  const body = listHolders().map((row) => columns.map(([key]) => escape(exportValue(row, key))).join(','));
  res.type('text/csv').attachment('device-holders.csv');
  res.send([columns.map(([, head]) => head).join(','), ...body].join('\r\n'));
});

app.get('/api/export.xlsx', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  const columns = exportColumns(req.session.role);
  const headings = columns.map(([, head]) => head);
  const rows = listHolders();
  const shape = (list) => list.map((row) =>
    Object.fromEntries(columns.map(([key, head]) => [head, exportValue(row, key)])));
  const widths = columns.map(([key]) =>
    (['name', 'position', 'department'].includes(key) ? 28 : key === 'rem' ? 26 : 14));

  const sheets = [
    { name: 'Holders', headings, widths, filter: true, rows: shape(rows) },
  ];

  const leavers = rows.filter((row) => row.resigned);
  if (leavers.length) {
    sheets.push({ name: 'To retrieve', headings, widths, rows: shape(leavers) });
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
  sheets.push({
    name: 'Summary',
    headings: ['Type', 'People', 'Laptops', 'iPads', 'Units', 'Resigned'],
    widths: [12, 9, 9, 8, 8, 10],
    rows: [...counts.values()],
  });

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
    const body = downs.map((d) => {
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
    return { headings: [firstLabel, ...acrosses, 'Total'], rows: body };
  };

  const byType = pivot(asset.rows, 'type', 'status', 'Asset type');
  sheets.push({ name: 'Assets by type', ...byType,
    widths: [22, ...Array(byType.headings.length - 1).fill(13)] });

  const byModel = pivot(
    asset.rows.filter((r) => r.type === 'Laptop' || r.type === 'iPad'), 'model', 'status', 'Model');
  sheets.push({ name: 'Laptops and iPads by model', ...byModel,
    widths: [22, ...Array(byModel.headings.length - 1).fill(13)] });

  const byAge = pivot(asset.rows, 'type', 'age', 'Asset type');
  sheets.push({ name: 'Asset age', ...byAge,
    widths: [22, ...Array(byAge.headings.length - 1).fill(16)] });

  if (asset.duplicates.length) {
    sheets.push({
      name: 'Duplicate serials',
      headings: ['Serial', 'Asset type', 'Model', 'Listed as', 'Assigned to', 'Note'],
      widths: [16, 14, 18, 30, 22, 58],
      rows: asset.duplicates.map((d) => ({
        Serial: d.serial, 'Asset type': d.asset_type, Model: d.model,
        'Listed as': d.statuses.join(' / '), 'Assigned to': d.holder,
        Note: 'One serial is one piece of hardware, so this is counted once.',
      })),
    });
  }

  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment('device-holders.xlsx');
  res.send(writeWorkbook(sheets));
});

/* The asset list for an audit: the rows the Assets tab is showing, narrowed
   by the same search and filters it sends, with empty Found and Notes
   columns for whoever walks round and checks the hardware. No contact
   details, so every role may take it. The matching rules are the Assets
   tab's own (matches() in public/assets.js); keep the two in step. */
app.get('/api/assets/audit.xlsx', requireRole('admin', 'editor', 'viewer'), (req, res) => {
  const view = {
    q: String(req.query.q || ''), status: String(req.query.status || ''),
    type: String(req.query.type || ''), held: String(req.query.held || ''),
  };
  const waiting = new Set(resign.listToRetrieve().rows.map((row) => row.serial));
  const terms = view.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = (value) => (value === null || value === undefined ? '' : String(value));
  const rows = assets.listAssets().filter((asset) => {
    if (view.status && text(asset.status) !== view.status) return false;
    if (view.type && text(asset.asset_type) !== view.type) return false;
    if (view.held === 'yes' && !asset.held) return false;
    if (view.held === 'no' && asset.held) return false;
    if (view.held === 'retrieve' && !waiting.has(asset.serial)) return false;
    const hay = [asset.serial, asset.asset_type, asset.kind, asset.model, asset.status,
      asset.holder, asset.host_name, asset.remarks, asset.os].join(' ').toLowerCase();
    return terms.every((term) => hay.includes(term));
  }).sort((a, b) => text(a.serial).localeCompare(text(b.serial), undefined, { numeric: true }));

  const department = new Map(listHolders().map((h) => [h.id, h.department || '']));
  const headings = ['Serial', 'Asset type', 'Model', 'Status', 'Held by', 'Department', 'Since',
    'Age', 'Host name', 'Invoice date', 'Purchase date', 'Remark', 'Found', 'Notes'];
  const audit = rows.map((a) => ({
    Serial: a.serial, 'Asset type': a.asset_type || a.kind, Model: a.model, Status: a.status,
    'Held by': a.held ? text(a.holder) || 'somebody' : 'In stock',
    Department: a.held ? department.get(a.holder_id) || '' : '',
    Since: a.assigned_on, Age: a.age_years, 'Host name': a.host_name,
    'Invoice date': a.invoice_date, 'Purchase date': a.purchased_on, Remark: a.remarks,
    Found: '', Notes: '',
  }));

  const held = { yes: 'Out with somebody', no: 'In stock', retrieve: 'Waiting to come back' }[view.held];
  const narrowed = [
    view.q.trim() && ['Search', view.q.trim()],
    view.status && ['Status', view.status],
    view.type && ['Asset type', view.type],
    held && ['Where', held],
  ].filter(Boolean);
  const day = new Date().toISOString().slice(0, 10);
  const about = [
    ['Taken', new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })],
    ['By', req.session.label || req.session.role],
    ['Assets listed', `${rows.length} ${rows.length === 1 ? 'asset' : 'assets'}`],
    ...(narrowed.length ? narrowed : [['Narrowed to', 'Nothing: every asset on the register']]),
    ['How to use it', 'Tick Found for each piece you see, and write anything worth knowing under Notes.'],
  ].map(([What, Value]) => ({ What, Value }));

  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment(`asset-audit-${day}.xlsx`);
  res.send(writeWorkbook([
    { name: 'Audit', headings, filter: true, rows: audit,
      widths: [18, 14, 22, 18, 24, 20, 12, 6, 16, 13, 13, 26, 8, 30] },
    { name: 'About this list', headings: ['What', 'Value'], widths: [16, 60], rows: about },
  ]));
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

/* Changing the password here rewrites the ADMIN_PASSWORD line in .env and
   nothing else, keeping whatever encoding and line endings the file already
   had. Where there is no .env to write — a container taking its environment
   from compose, say — the change still takes effect, but only until restart,
   and the answer says so rather than pretending it was saved. */
/* What the reader at the top of this file would make of a line. A password
   has to come back out of .env exactly as it went in, or it works until the
   next restart and then silently becomes a different password. */
const readBackFromEnv = (text, key) => {
  let found;
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && match[1] === key) found = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return found;
};

const saveAdminPassword = (next) => {
  try {
    if (!fs.existsSync(envFile)) return { saved: false };
    const raw = fs.readFileSync(envFile, 'utf8');
    const bom = raw.startsWith('﻿') ? '﻿' : '';
    const body = bom ? raw.slice(1) : raw;
    const eol = body.includes('\r\n') ? '\r\n' : '\n';
    let replaced = false;
    const lines = body.split(/\r?\n/).map((line) => {
      if (!/^\s*ADMIN_PASSWORD\s*=/.test(line)) return line;
      replaced = true;
      return `ADMIN_PASSWORD=${next}`;
    });
    if (!replaced) lines.push(`ADMIN_PASSWORD=${next}`);
    const updated = bom + lines.join(eol);

    /* Check before writing, not after. A password that will not survive the
       round trip is refused outright: changing it in memory and leaving the
       file disagreeing is how somebody gets locked out at the next restart. */
    if (readBackFromEnv(updated, 'ADMIN_PASSWORD') !== next) {
      return { saved: false, wouldNotSurvive: true };
    }

    fs.writeFileSync(envFile, updated);
    return { saved: true };
  } catch (error) {
    console.error('could not write the new password to .env:', error && error.message);
    return { saved: false };
  }
};

app.post('/api/password', requireRole('admin'), (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');

  if (!checkAdminPassword(current)) {
    return res.status(401).json({ error: 'That is not the password you are signed in with.' });
  }
  if (next.length < 8) {
    return res.status(400).json({ error: 'The new password needs at least 8 characters.' });
  }
  if (isPlaceholderPassword(next)) {
    return res.status(400).json({ error: 'The app refuses that one on purpose. Pick another.' });
  }
  if (next === current) {
    return res.status(400).json({ error: 'That is the password you already have.' });
  }

  const outcome = saveAdminPassword(next);
  if (outcome.wouldNotSurvive) {
    return res.status(400).json({
      error: 'A password that begins or ends with a space or a quotation mark cannot be '
        + 'stored in the settings file as typed, so it would stop working the next time '
        + 'the app restarts. Nothing was changed. Use one without those.',
    });
  }
  const saved = outcome.saved;
  setAdminPassword(next);

  /* The stamp has moved, so every admin cookie issued under the old password
     is now refused — including this one. Hand this admin a fresh one so the
     person who made the change is not the one thrown out by it. */
  res.cookie(cookieName, makeSession('admin', req.session.label, adminStamp()), cookieOptions());
  recordChange({
    at: new Date().toISOString(), actor: req.session.label, field: 'admin password',
    was: 'the previous one', now: saved ? 'changed and saved' : 'changed until restart',
  });
  res.json({ ok: true, saved });
});

app.post('/api/invites/:token/revoke', requireRole('admin'), (req, res) => {
  db.prepare('UPDATE invites SET revoked = 1 WHERE token = ?').run(req.params.token);
  res.json({ ok: true });
});

/* Editors can see the change log too: it is the record of what they and
   everyone else did, and hiding it from the people making the changes helps
   nobody. Viewers do not get it. */
app.get('/api/audit', requireRole('admin', 'editor'), (req, res) => {
  /* SQLite reads a negative LIMIT as no limit at all, so -1 returned the lot. */
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 500, 5000));
  const range = auditRange(req, res);
  if (!range) return;
  res.json({ entries: auditFor(listAudit(limit, range), req.session.role), total: countAudit(range) });
});

/* A new workbook can change somebody's email or network ID, and that change
   is logged with both values. Editors read the log, so for them the values
   are hidden and only the fact of the change is left. */
const CONTACT_LABELS = new Set(['Network ID', 'Email']);
const auditFor = (entries, role) => (role === 'admin' ? entries : entries.map((e) =>
  (CONTACT_LABELS.has(e.field) ? { ...e, old_value: '(hidden)', new_value: '(hidden)' } : e)));

/* An optional from and to on the change log, as ISO times; the page sends
   the start and end of the days somebody picked, in their own time zone. */
function auditRange(req, res) {
  const read = (value) => {
    if (value === undefined || value === '') return '';
    const text = String(value);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(Date.parse(text))) return null;
    return new Date(text).toISOString();
  };
  const from = read(req.query.from);
  const to = read(req.query.to);
  if (from === null || to === null) {
    res.status(400).json({ error: 'That date could not be read.' });
    return null;
  }
  return { from, to };
}

app.get('/api/audit.csv', requireRole('admin', 'editor'), (req, res) => {
  const escape = csvCell;
  const head = ['When', 'Who', 'Holder or asset', 'Field', 'Was', 'Became', 'Ticket'];
  const range = auditRange(req, res);
  if (!range) return;
  const body = auditFor(listAudit(5000, range), req.session.role).map((e) =>
    [e.at, e.actor, e.name || e.serial || e.holder_id, e.field, e.old_value, e.new_value, e.ticket]
      .map(escape).join(','));
  res.type('text/csv').attachment('change-log.csv');
  res.send([head.join(','), ...body].join('\r\n'));
});

app.get('/api/problems', requireRole('admin', 'editor'), (req, res) => res.json(listProblems()));

/* ---------- the page ---------- */

/* The scripts and stylesheet are named with a version on their address, so
   a browser may keep them for an hour. The page itself is checked every
   time: kept for an hour, it went on showing the old page after an upgrade,
   with whatever mix of old and new scripts the browser happened to hold. */
const noCacheForPages = (res, file) => {
  if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
};
app.use(express.static(path.join(here, '..', 'public'),
  { index: 'index.html', maxAge: '1h', setHeaders: noCacheForPages }));

/* Run as a service there is no console to print to, so a failure that would
   have been one line on screen becomes complete silence — and the page says
   only "something went wrong". Keep a file beside the app instead.
   The message and code only: body-parser hangs the raw request body off its
   errors, and on these routes that body is somebody's staff list. */
const logFile = path.join(here, '..', 'error.log');
const noteProblem = (text) => {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()}  ${text}\n`);
  } catch { /* a log that cannot be written is not worth crashing over */ }
};

app.use((err, req, res, next) => {
  const code = (err && (err.code || err.type)) || '';
  /* Plain ASCII: this file gets opened in Notepad, which renders a UTF-8
     em-dash as mojibake and makes the line look corrupted. */
  const detail = `${req.method} ${req.path} - ${err && err.message}${code ? ` [${code}]` : ''}`;
  console.error('request failed:', detail);
  noteProblem(detail);

  const status = Number(err && (err.status || err.statusCode)) || 500;
  if (status === 413) {
    return res.status(413).json({ error: 'That paste is too big to send in one go.' });
  }
  if (status === 400) {
    return res.status(400).json({ error: 'That did not arrive as readable JSON.' });
  }

  /* A register that cannot be written to is the likeliest cause of a failure
     here, and it needs saying: every symptom looks like a different bug —
     links will not generate, corrections will not save, nothing is logged —
     when the one answer is that the file or its folder is read-only. */
  const said = `${code} ${err && err.message}`;
  if (/SQLITE_READONLY|SQLITE_CANTOPEN|readonly database|unable to open database/i.test(said)) {
    return res.status(500).json({
      error: 'The register cannot be saved to. Its database file, or the folder holding '
        + 'it, is read-only — so nothing can be written. Details are in error.log beside '
        + 'the app.',
    });
  }
  if (/SQLITE_BUSY|database is locked/i.test(said)) {
    return res.status(503).json({
      error: 'The register is busy writing something else. Try again in a moment. If it '
        + 'keeps happening, something other than the app has the database open.',
    });
  }

  res.status(500).json({
    error: 'Something went wrong on the server. The reason is in error.log beside the app.',
  });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM holders').get().n;
  if (!count) console.warn('The register is empty. Run `npm run import` first.');
  console.log(`Device register on http://localhost:${port} (${count} holders)`);
});
