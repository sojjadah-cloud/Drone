import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, now, toUser } from './db.ts';
import { can } from '../shared/domain.ts';
import type { Permission, Role, UserDTO } from '../shared/domain.ts';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // one operational shift
const LOCK_AFTER = 5;
const LOCK_MS = 10 * 60 * 1000;
export const SESSION_COOKIE = 'fg_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDTO;
      csrf?: string;
    }
  }
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hashIp = (ip: string | undefined) => (ip ? sha256(`fg-ip:${ip}`).slice(0, 24) : null);

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export type LoginResult =
  | { ok: true; token: string; csrf: string; user: UserDTO }
  | { ok: false; reason: 'invalid' | 'locked' | 'inactive' };

export function login(username: string, password: string, ip: string | undefined): LoginResult {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as Record<string, any> | undefined;
  if (!row) {
    // Equalize timing for unknown users
    verifyPassword(password, hashPassword('timing-equalizer'));
    return { ok: false, reason: 'invalid' };
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) return { ok: false, reason: 'locked' };
  if (!row.active) return { ok: false, reason: 'inactive' };
  if (!verifyPassword(password, row.password_hash)) {
    const failed = row.failed_logins + 1;
    const lock = failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, row.id);
    return { ok: false, reason: lock ? 'locked' : 'invalid' };
  }
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const t = now();
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(t, row.id);
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, expires_at, ip) VALUES (?,?,?,?,?,?)').run(
    sha256(token),
    row.id,
    csrf,
    t,
    new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    hashIp(ip),
  );
  return { ok: true, token, csrf, user: toUser({ ...row, last_login_at: t }) };
}

export function logout(req: Request) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function sessionCookie(token: string, maxAgeMs = SESSION_TTL_MS) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

export function resolveSession(cookieHeader: string | undefined): { user: UserDTO; csrf: string } | null {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.*, s.csrf, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as Record<string, any> | undefined;
  if (!row || new Date(row.expires_at).getTime() < Date.now() || !row.active) return null;
  return { user: toUser(row), csrf: row.csrf };
}

/** Attaches req.user if a valid session exists. */
export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const s = resolveSession(req.headers.cookie);
  if (s) {
    req.user = s.user;
    req.csrf = s.csrf;
  }
  next();
}

/** Require auth (and optionally a permission). State-changing methods also require the CSRF header. */
export function requireAuth(perm?: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const header = req.get('x-csrf-token');
      if (!header || header !== req.csrf) return res.status(403).json({ error: 'csrf' });
    }
    if (perm && !can(req.user.role, perm)) {
      audit(req, 'permission.denied', 'permission', perm, { path: req.path });
      return res.status(403).json({ error: 'forbidden', permission: perm });
    }
    next();
  };
}

export function requireAny(...perms: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!perms.some((p) => can(req.user!.role, p))) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

export function audit(
  req: Request | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  detail: Record<string, unknown> = {},
  actorOverride?: { name: string; role: Role | null },
) {
  db.prepare('INSERT INTO audit_logs (at, actor, role, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?,?,?)').run(
    now(),
    actorOverride?.name ?? req?.user?.username ?? null,
    actorOverride?.role ?? req?.user?.role ?? null,
    action,
    entity,
    entityId === null ? null : String(entityId),
    JSON.stringify(detail),
    hashIp(req?.ip),
  );
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory fixed window). Production: back with Redis so limits hold across instances.
// ---------------------------------------------------------------------------
export function rateLimit(name: string, max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip}`;
    const t = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < t) {
      hits.set(key, { count: 1, reset: t + windowMs });
      return next();
    }
    h.count++;
    if (h.count > max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - t) / 1000));
      return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  };
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

// ---------------------------------------------------------------------------
// Validation helpers (no external schema lib to keep the trusted surface small)
// ---------------------------------------------------------------------------
export class ValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new ValidationError(field, 'invalid_option');
  return v as T;
}
export function str(v: unknown, field: string, { min = 0, max = 2000, optional = false } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (optional || min === 0) return '';
    throw new ValidationError(field, 'required');
  }
  if (typeof v !== 'string') throw new ValidationError(field, 'invalid');
  const s = v.trim();
  if (s.length < min) throw new ValidationError(field, 'too_short');
  if (s.length > max) throw new ValidationError(field, 'too_long');
  return s;
}
export function num(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new ValidationError(field, 'out_of_range');
  return n;
}
