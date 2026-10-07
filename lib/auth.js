import crypto from 'crypto';
import sql from './db.js';

const COOKIE_NAME = 'budget_session';
// Sliding inactivity window: requireAuth renews this on every authenticated
// request, so the session only dies after MAX_AGE with no requests at all —
// not MAX_AGE after login.
const MAX_AGE = 60 * 15; // 15 minutos de inatividade

// Session tokens are signed with a fixed server-side secret so that changing
// the login password doesn't itself need to invalidate the signing key logic.
// SESSION_SECRET must be a long random string: the initial APP_PASSWORD is often
// a well-known default, and signing with it would let anyone forge a session.
function signingSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET não configurada');
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');
}

// Password is stored hashed (scrypt + random salt) in app_config once the
// user changes it via Settings; falls back to APP_PASSWORD env var until then.
export async function getStoredPasswordHash() {
  const rows = await sql`SELECT value FROM app_config WHERE key = 'app_password_hash'`;
  return rows[0]?.value || null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyHashedPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function verifyPassword(password) {
  const stored = await getStoredPasswordHash();
  if (stored) return verifyHashedPassword(password, stored);
  return password === process.env.APP_PASSWORD;
}

// Login rate limiting: 5 failed attempts from the same IP within 15 minutes
// locks that IP out for 15 minutes. State lives in `login_attempts` (one row
// per IP) rather than in-memory, since serverless instances don't share memory
// and get recycled between invocations.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Returns remaining lock seconds if the IP is currently locked out, else null.
export async function checkLoginLock(ip) {
  const [row] = await sql`SELECT locked_until FROM login_attempts WHERE ip = ${ip}`;
  if (!row?.locked_until) return null;
  const remainingMs = new Date(row.locked_until).getTime() - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : null;
}

export async function recordFailedLogin(ip) {
  const [row] = await sql`SELECT failures, first_failure_at FROM login_attempts WHERE ip = ${ip}`;
  const now = Date.now();
  const windowExpired = row && now - new Date(row.first_failure_at).getTime() > WINDOW_MS;

  if (!row || windowExpired) {
    await sql`
      INSERT INTO login_attempts (ip, failures, first_failure_at, locked_until)
      VALUES (${ip}, 1, NOW(), NULL)
      ON CONFLICT (ip) DO UPDATE SET failures = 1, first_failure_at = NOW(), locked_until = NULL
    `;
    return;
  }

  const failures = row.failures + 1;
  const lockedUntil = failures >= MAX_ATTEMPTS ? new Date(now + LOCK_MS) : null;
  await sql`
    UPDATE login_attempts SET failures = ${failures}, locked_until = ${lockedUntil}
    WHERE ip = ${ip}
  `;
}

export async function clearLoginAttempts(ip) {
  await sql`DELETE FROM login_attempts WHERE ip = ${ip}`;
}

export async function setPassword(newPassword) {
  const hashed = hashPassword(newPassword);
  await sql`
    INSERT INTO app_config (key, value) VALUES ('app_password_hash', ${hashed})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export function createSessionCookie() {
  const expiry = Date.now() + MAX_AGE * 1000;
  const token = `${expiry}.${sign(String(expiry))}`;
  // No Max-Age/Expires → session cookie: cleared when the browser is closed,
  // forcing a fresh password login on the next launch.
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').filter(Boolean).map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

export function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;

  const [expiry, sig] = token.split('.');
  if (!expiry || !sig) return false;
  if (Date.now() > Number(expiry)) return false;

  const expected = sign(expiry);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function requireAuth(handler) {
  return async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    res.setHeader('Set-Cookie', createSessionCookie());
    return handler(req, res);
  };
}
