import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSessionSecret } from './config.js';

const SECRET = getSessionSecret();
const COOKIE = 'dash_session';
const USER = process.env.DASH_USER || 'admin';
const PASSWORD_HASH = bcrypt.hashSync(process.env.DASH_PASSWORD || 'change-me', 10);
const SESSION_DAYS = 30;

// crude brute-force throttle: per-IP failure counter
const failures = new Map();
function throttled(ip) {
  const f = failures.get(ip);
  return f && f.count >= 5 && Date.now() - f.at < 60_000;
}
function recordFailure(ip) {
  const f = failures.get(ip) || { count: 0, at: 0 };
  failures.set(ip, { count: f.count + 1, at: Date.now() });
}

export async function login(req, res) {
  const ip = req.ip;
  if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts, wait a minute' });
  const { username, password } = req.body || {};
  const ok = username === USER && (await bcrypt.compare(password || '', PASSWORD_HASH));
  if (!ok) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  failures.delete(ip);
  const token = jwt.sign({ sub: USER }, SECRET, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
    path: '/',
  });
  res.json({ ok: true, user: USER });
}

export function logout(_req, res) {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    req.user = jwt.verify(token, SECRET).sub;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}
