import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE = 'dr_session';
const MAX_AGE_DAYS = 14;

if (!SECRET || SECRET === 'change-me-to-32-random-bytes') {
  console.error('SESSION_SECRET is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}
if (!ADMIN_PASSWORD || ADMIN_PASSWORD === 'change-me') {
  console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

/** A session is `role.label.expiry.signature`; the signature covers the rest. */
export function makeSession(role, label) {
  const expiry = Date.now() + MAX_AGE_DAYS * 86400000;
  const body = [role, Buffer.from(label).toString('base64url'), expiry].join('.');
  return `${body}.${sign(body)}`;
}

export function readSession(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [role, label, expiry, signature] = parts;
  const body = [role, label, expiry].join('.');
  const expected = sign(body);
  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  if (!Number(expiry) || Number(expiry) < Date.now()) return null;
  if (!['admin', 'editor', 'viewer'].includes(role)) return null;
  return { role, label: Buffer.from(label, 'base64url').toString() };
}

/** Constant-time so a wrong password cannot be found a character at a time. */
export function checkAdminPassword(given) {
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
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
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export const newToken = () => crypto.randomBytes(16).toString('base64url');

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
