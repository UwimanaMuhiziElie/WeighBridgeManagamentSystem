import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.use(requireRole(['admin', 'manager']));

function badRequest(res: Response, message: string) {
  return res.status(400).json({ success: false, error: message });
}
function notFound(res: Response, message: string) {
  return res.status(404).json({ success: false, error: message });
}
function forbidden(res: Response, message: string) {
  return res.status(403).json({ success: false, error: message });
}
function serverError(res: Response) {
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

function normalizeText(v: unknown, maxLen = 255): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeEmail(v: unknown): string {
  const s = normalizeText(v, 254).toLowerCase();
  if (!s) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  return s;
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

const SAFE_USER_COLUMNS = `
  id,
  email,
  full_name,
  role,
  is_active,
  created_at,
  updated_at
`;

const ALLOWED_ROLES = new Set(['operator', 'admin', 'manager']);

/**
 * GET /api/users?role=operator&include_inactive=true
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const role = typeof req.query.role === 'string' ? req.query.role.trim() : '';
    const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';

    if (role && !ALLOWED_ROLES.has(role)) {
      return badRequest(res, 'Invalid role filter');
    }

    const params: any[] = [];
    let where = 'WHERE 1=1';

    if (role) {
      params.push(role);
      where += ` AND role = $${params.length}`;
    }

    if (!includeInactive) {
      where += ` AND is_active = true`;
    }

    const result = await query(
      `SELECT ${SAFE_USER_COLUMNS}
       FROM users
       ${where}
       ORDER BY created_at DESC
       LIMIT 200`,
      params
    );

    return res.json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Get users error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * POST /api/users
 * body: { email, password, full_name, role, is_active? }
 *
 * Restriction:
 * - manager cannot create an admin (only admin can)
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const requesterRole = req.user?.role;

    const email = normalizeEmail(req.body?.email);
    const password = normalizeText(req.body?.password, 200);
    const full_name = normalizeText(req.body?.full_name, 120);
    const role = normalizeText(req.body?.role, 20) || 'operator';
    const is_active = req.body?.is_active === undefined ? true : !!req.body.is_active;

    if (!email) return badRequest(res, 'Valid email is required');
    if (!password || password.length < 8) return badRequest(res, 'Password must be at least 8 characters');
    if (!ALLOWED_ROLES.has(role)) return badRequest(res, 'Invalid role');

    if (requesterRole === 'manager' && role === 'admin') {
      return forbidden(res, 'Managers cannot create admin users');
    }

    const exists = await query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'User with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const created = await query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SAFE_USER_COLUMNS}`,
      [email, password_hash, full_name || null, role, is_active]
    );

    return res.status(201).json({ success: true, data: created.rows[0] });
  } catch (error: any) {
    console.error('Create user error', { code: error?.code, message: error?.message });
    if (error?.code === '23505') {
      return res.status(409).json({ success: false, error: 'Conflict' });
    }
    return serverError(res);
  }
});

/**
 * PUT /api/users/:id
 * body: { full_name?, role?, is_active?, password? }
 *
 * Restriction:
 * - manager cannot promote to admin
 * - cannot change your own role (safety guard)
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role;

    const full_name = req.body?.full_name === undefined ? undefined : normalizeText(req.body.full_name, 120);
    const role = req.body?.role === undefined ? undefined : normalizeText(req.body.role, 20);
    const is_active = req.body?.is_active === undefined ? undefined : !!req.body.is_active;
    const password = req.body?.password === undefined ? undefined : normalizeText(req.body.password, 200);

    if (role !== undefined) {
      if (!ALLOWED_ROLES.has(role)) return badRequest(res, 'Invalid role');
      if (requesterRole === 'manager' && role === 'admin') {
        return forbidden(res, 'Managers cannot promote users to admin');
      }
      if (requesterId && requesterId === id) {
        return forbidden(res, 'You cannot change your own role');
      }
    }

    const existing = await query(`SELECT id FROM users WHERE id = $1 LIMIT 1`, [id]);
    if (existing.rows.length === 0) return notFound(res, 'User not found');

    const fields: string[] = [];
    const params: any[] = [];
    let idx = 0;

    if (full_name !== undefined) {
      idx++; fields.push(`full_name = $${idx}`); params.push(full_name || null);
    }
    if (role !== undefined) {
      idx++; fields.push(`role = $${idx}`); params.push(role);
    }
    if (is_active !== undefined) {
      idx++; fields.push(`is_active = $${idx}`); params.push(is_active);
    }
    if (password !== undefined) {
      if (!password || password.length < 8) return badRequest(res, 'Password must be at least 8 characters');
      const password_hash = await bcrypt.hash(password, 12);
      idx++; fields.push(`password_hash = $${idx}`); params.push(password_hash);
    }

    if (fields.length === 0) {
      return badRequest(res, 'No fields to update');
    }

    idx++; fields.push(`updated_at = NOW()`);

    params.push(id);

    const updated = await query(
      `UPDATE users
       SET ${fields.join(', ')}
       WHERE id = $${params.length}
       RETURNING ${SAFE_USER_COLUMNS}`,
      params
    );

    return res.json({ success: true, data: updated.rows[0] });
  } catch (error: any) {
    console.error('Update user error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * DELETE /api/users/:id
 * Soft delete: sets is_active=false
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    if (req.user?.id === id) {
      return forbidden(res, 'You cannot delete your own account');
    }

    const updated = await query(
      `UPDATE users
       SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING ${SAFE_USER_COLUMNS}`,
      [id]
    );

    if (updated.rows.length === 0) return notFound(res, 'User not found');
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error: any) {
    console.error('Delete user error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

export default router;
