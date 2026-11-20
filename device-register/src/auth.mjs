import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || '';
/* Not a constant: an admin can change it from inside the app now, and every
   admin session carries a stamp of it, so the two have to move together. */
let adminPassword = process.env.ADMIN_PASSWORD || '';
const COOKIE = 'dr_session';
const MAX_AGE_DAYS = 14;

if (!SECRET || SECRET === 'change-me-to-32-random-bytes') {
  console.error('SESSION_SECRET is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}
if (isPlaceholderPassword(adminPassword)) {
  console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

/** What the app refuses to start on, so the change-password route can refuse
    the same thing rather than letting somebody set it from inside. */
export function isPlaceholderPassword(value) {
  return !value || String(value) === 'change-me';
}

const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

/** A session is `role.label.expiry.invite.signature`; the signature covers the
    rest. `invite` is the token of the link that minted it, or `-` for a
    password sign-in, so the server can refuse a link that has since been
    revoked instead of honouring the cookie for its full fourteen days. */
export function makeSession(role, label, invite = '-') {
  const expiry = Date.now() + MAX_AGE_DAYS * 86400000;
  const body = [role, Buffer.from(label).toString('base64url'), expiry, invite || '-'].join('.');
  return `${body}.${sign(body)}`;
}

export function readSession(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('.');
  if (parts.length !== 5) return null;
  const [role, label, expiry, invite, signature] = parts;
  const body = [role, label, expiry, invite].join('.');
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  /* Byte length, not character length: timingSafeEqual throws when the two
     buffers differ in size, and a signature of the right character count can
     still be a different number of bytes. */
  if (expected.length !== given.length) return null;
  if (!crypto.timingSafeEqual(expected, given)) return null;
  if (!Number(expiry) || Number(expiry) < Date.now()) return null;
  if (!['admin', 'editor', 'viewer'].includes(role)) return null;
  return { role, label: Buffer.from(label, 'base64url').toString(), invite };
}

/** Constant-time so a wrong password cannot be found a character at a time. */
export function checkAdminPassword(given) {
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Called by the change-password route once the new one is safely on disk.
    It moves the stamp below, which is what ends every other admin session. */
export function setAdminPassword(next) {
  adminPassword = String(next ?? '');
}

export const cookieName = COOKIE;

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.SECURE_COOKIES === '1',
  maxAge: MAX_AGE_DAYS * 86400000,
  path: '/',
});

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const raw = part.slice(index + 1).trim();
    /* A stray % is not ours to object to. Letting decodeURIComponent throw
       here turned one malformed cookie into a 500 on every request from that
       browser, including the page somebody would use to clear it. */
    let value = raw;
    try { value = decodeURIComponent(raw); } catch { value = raw; }
    out[part.slice(0, index).trim()] = value;
  }
  return out;
}

export const newToken = () => crypto.randomBytes(16).toString('base64url');

/* A stamp of the current admin password, carried in an admin session where an
   invite session carries its token. Checking it on every request is what makes
   changing ADMIN_PASSWORD end the sessions it let in — until now a departing
   admin's cookie stayed good for its full fourteen days, and the only way to
   stop it also signed out every invited viewer and editor.
   `~` cannot occur in a base64url invite token, so the two never collide. */
export const adminStamp = () => `~${crypto.createHash('sha256')
  .update(adminPassword).digest('base64url').slice(0, 10)}`;

/** Attaches `req.session`; never rejects, so routes decide what a role may do. */
export function sessions(req, res, next) {
  req.session = readSession(parseCookies(req.headers.cookie)[COOKIE]) || null;
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.session) return res.status(401).json({ error: 'Sign in first.' });
  if (!roles.includes(req.session.role)) {
    return res.status(403).json({ error: 'Your link does not allow that.' });
  }
  next();
};
