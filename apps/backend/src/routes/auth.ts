import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

function mustGetJwtSecret() {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not set');
  }
  return JWT_SECRET;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  // simple, safe check (don’t overcomplicate)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signToken(user: { id: string; email: string; role: string; branch_id?: string | null }) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id ?? null,
    },
    mustGetJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' }
  );
}

router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body || {};

    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: 'email, password, and fullName are required',
      });
    }

    const emailNorm = normalizeEmail(String(email));
    if (!isValidEmail(emailNorm)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters',
      });
    }

    // IMPORTANT: Never accept role from user input (prevents privilege escalation)
    const role = 'operator';

    const existingUser = await query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [emailNorm]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // NOTE: branch assignment should be done by admin workflow / seed scripts, not public signup.
    // If your users table has branch_id, it can be NULL at signup and later updated by admin.
    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, role, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, email, full_name, role, created_at, branch_id`,
      [emailNorm, hashedPassword, String(fullName).trim(), role]
    );

    const user = result.rows[0];
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id ?? null,
    });

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          branch_id: user.branch_id ?? null,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const emailNorm = normalizeEmail(String(email));
    if (!isValidEmail(emailNorm)) {
      // keep error generic enough
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const result = await query(
      `SELECT id, email, password_hash, full_name, role, branch_id
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [emailNorm]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(String(password), user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id ?? null,
    });

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          branch_id: user.branch_id ?? null,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, role, created_at, branch_id FROM users WHERE id = $1',
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.json({ success: true, data: { user: result.rows[0] } });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/logout', authenticate, (_req, res) => {
  // JWT logout is client-side (token deletion). Server-side revocation is a separate feature.
  return res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
