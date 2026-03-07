// apps/backend/src/routes/auth.ts
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type Algorithm, type Secret, type SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';

const router = Router();

/**
 * ENV:
 * - JWT_SECRET (required)
 * - JWT_ACCESS_EXPIRES_IN (optional, e.g. "15m")
 * - JWT_EXPIRES_IN (optional fallback, e.g. "7d")
 *
 * Rate limit / lockout:
 * - AUTH_LOGIN_WINDOW_MS (default 10min)
 * - AUTH_LOGIN_MAX_ATTEMPTS (default 10)
 * - AUTH_LOCKOUT_THRESHOLD (default 8)
 * - AUTH_LOCKOUT_MS (default 15min)
 */

const JWT_ALG: Algorithm = 'HS256';

const WINDOW_MS = Number(process.env.AUTH_LOGIN_WINDOW_MS || 10 * 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 10);
const LOCKOUT_THRESHOLD = Number(process.env.AUTH_LOCKOUT_THRESHOLD || 8);
const LOCKOUT_MS = Number(process.env.AUTH_LOCKOUT_MS || 15 * 60 * 1000);

type Hit = { count: number; resetAt: number };
type Lock = { lockedUntil: number; fails: number };

const loginHits = new Map<string, Hit>(); // key: ip|email
const lockouts = new Map<string, Lock>(); // key: emailNorm

function nowMs() {
  return Date.now();
}

function normalizeEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

function getIp(req: Request): string {
  // Only trust forwarded headers if trust proxy is enabled.
  const trustProxy = !!req.app.get('trust proxy');

  if (trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

function mustGetJwtSecret(): Secret {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret as Secret;
}

/**
 * jsonwebtoken types are strict:
 * - expiresIn must be number OR ms-like string (e.g. "15m", "7d", "3600")
 * This function validates and returns a correctly-typed value.
 */
function getJwtExpiry(): SignOptions['expiresIn'] {
  const raw = String(process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m').trim();

  // "3600"
  if (/^\d+$/.test(raw)) return Number(raw);

  // "15m", "7d", "1h", "500ms"
  if (/^\d+(ms|s|m|h|d|w|y)$/.test(raw)) return raw as any;

  // fallback safe default
  return '15m' as any;
}

function issueAccessToken(payload: { userId: string; email: string; role: string; branchId: string | null }) {
  const tokenPayload = {
    sub: payload.userId,
    email: payload.email,
    role: payload.role,
    branchId: payload.branchId,
    type: 'access',
    jti: crypto.randomUUID(),
  };

  const opts: SignOptions = {
    algorithm: JWT_ALG,
    expiresIn: getJwtExpiry(),
  };

  return jwt.sign(tokenPayload, mustGetJwtSecret(), opts);
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, mustGetJwtSecret(), {
    algorithms: [JWT_ALG],
  });
}

function loginRateLimit(req: Request, res: Response, next: () => void) {
  const ip = getIp(req);
  const emailNorm = normalizeEmail(req.body?.email);
  const key = `${ip}|${emailNorm || 'noemail'}`;

  const t = nowMs();
  const current = loginHits.get(key);

  if (!current || current.resetAt <= t) {
    loginHits.set(key, { count: 1, resetAt: t + WINDOW_MS });
    return next();
  }

  current.count += 1;
  if (current.count > MAX_ATTEMPTS) {
    const retrySec = Math.max(1, Math.ceil((current.resetAt - t) / 1000));
    res.setHeader('Retry-After', String(retrySec));
    return res.status(429).json({
      error: 'Too many login attempts. Please try again later.',
      retry_after_seconds: retrySec,
    });
  }

  loginHits.set(key, current);
  return next();
}

function isLocked(emailNorm: string): { locked: boolean; remainingMs: number } {
  const l = lockouts.get(emailNorm);
  if (!l) return { locked: false, remainingMs: 0 };
  const t = nowMs();
  if (l.lockedUntil > t) return { locked: true, remainingMs: l.lockedUntil - t };
  lockouts.delete(emailNorm);
  return { locked: false, remainingMs: 0 };
}

function registerFail(emailNorm: string) {
  const t = nowMs();
  const l = lockouts.get(emailNorm) || { lockedUntil: 0, fails: 0 };
  l.fails += 1;

  if (l.fails >= LOCKOUT_THRESHOLD) {
    l.lockedUntil = t + LOCKOUT_MS;
    l.fails = 0;
  }

  lockouts.set(emailNorm, l);
}

function clearFails(emailNorm: string) {
  lockouts.delete(emailNorm);
}

// ---- ROUTES

router.post('/signup', async (req: Request, res: Response) => {
  try {
    const emailNorm = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const fullName = String(req.body?.full_name || req.body?.fullName || '').trim();

    if (!emailNorm || !emailNorm.includes('@')) {
      return res.status(400).json({ error: 'Invalid email.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const insertSql = `
      INSERT INTO users (email, password_hash, full_name, role, branch_id, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, 'operator', NULL, true, NOW(), NOW())
      RETURNING id, email, full_name, role, branch_id
    `;

    const { rows } = await pool.query(insertSql, [emailNorm, passwordHash, fullName || null]);
    const user = rows[0];

    const token = issueAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branch_id,
    });

    return res.status(201).json({
      user,
      access_token: token,
      token, // alias
    });
  } catch (e: any) {
    if (e?.code === '23505') {
      return res.status(409).json({ error: 'Email already exists.' });
    }
    console.error('[auth/signup] error:', e);
    return res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/login', loginRateLimit, async (req: Request, res: Response) => {
  try {
    const emailNorm = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!emailNorm || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const lock = isLocked(emailNorm);
    if (lock.locked) {
      return res.status(423).json({
        error: 'Account temporarily locked due to failed login attempts.',
        retry_after_seconds: Math.ceil(lock.remainingMs / 1000),
      });
    }

    const sql = `
      SELECT id, email, full_name, password_hash, role, branch_id, is_active
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
    `;
    const { rows } = await pool.query(sql, [emailNorm]);
    const user = rows[0];

    if (!user || user.is_active === false) {
      registerFail(emailNorm);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      registerFail(emailNorm);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    clearFails(emailNorm);

    const token = issueAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branch_id,
    });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name ?? null,
        role: user.role,
        branch_id: user.branch_id,
      },
      access_token: token,
      token, // alias
    });
  } catch (e) {
    console.error('[auth/login] error:', e);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ✅ GET /auth/me  (token required)
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { rows } = await pool.query(
      `
      SELECT id, email, full_name, role, branch_id, is_active
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (rows.length === 0 || rows[0].is_active === false) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const u = rows[0];

    return res.json({
      success: true,
      data: {
        user: {
          id: u.id,
          email: u.email,
          full_name: u.full_name ?? null,
          role: u.role,
          branch_id: u.branch_id,
        },
      },
    });
  } catch (e) {
    console.error('[auth/me] error:', e);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
});

export default router;
