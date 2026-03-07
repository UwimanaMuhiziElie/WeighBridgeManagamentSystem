// apps/backend/src/routes/api/users.ts
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

function normalizeBranchId(v: unknown): string | null | '__invalid__' {
  if (v === undefined || v === null) return null;
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  if (!isUuid(s)) return '__invalid__';
  return s;
}

async function ensureBranchExists(branchId: string): Promise<boolean> {
  const r = await query(`SELECT id FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
  return r.rows.length > 0;
}

async function resolveUserBranchId(userId: string): Promise<string | null> {
  try {
    const r1 = await query(`SELECT branch_id FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r1.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}
  try {
    const r2 = await query(`SELECT branch_id FROM user_profiles WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r2.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}
  return null;
}

/**
 * Branch scope:
 * - admin: can see all by default; can filter by ?branch_id=
 * - manager: MUST have a branch; cannot switch branch context; always scoped to own
 */
async function getBranchFilterForList(req: AuthRequest, res: Response): Promise<string | null | undefined> {
  const userId = req.user?.id;
  const role = req.user?.role;
  if (!userId || !role) {
    forbidden(res, 'Unauthorized');
    return undefined;
  }

  const requestedBranch = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';
  if (requestedBranch) {
    if (!isUuid(requestedBranch)) {
      badRequest(res, 'Invalid branch_id');
      return undefined;
    }
    if (role === 'admin') return requestedBranch;

    const own = await resolveUserBranchId(userId);
    if (!own) {
      forbidden(res, 'Manager is not assigned to any branch');
      return undefined;
    }
    if (own !== requestedBranch) {
      forbidden(res, 'Managers cannot switch branch context');
      return undefined;
    }
    return own;
  }

  if (role === 'admin') return null;

  const own = await resolveUserBranchId(userId);
  if (!own) {
    forbidden(res, 'Manager is not assigned to any branch');
    return undefined;
  }
  return own;
}

/**
 * Keep user_profiles.branch_id aligned with users.branch_id.
 * Non-fatal failures are handled at call sites.
 */
async function upsertUserProfileBranch(userId: string, branchId: string | null) {
  await query(
    `INSERT INTO user_profiles (id, branch_id)
     VALUES ($1, $2)
     ON CONFLICT (id)
     DO UPDATE SET branch_id = EXCLUDED.branch_id, updated_at = NOW()`,
    [userId, branchId]
  );
}

const SAFE_USER_COLUMNS = `
  id,
  email,
  full_name,
  role,
  branch_id,
  is_active,
  created_at,
  updated_at
`;

const ALLOWED_ROLES = new Set(['operator', 'admin', 'manager']);

function mustHaveBranch(role: string) {
  return role === 'operator' || role === 'manager';
}

/**
 * GET /api/users?role=operator&include_inactive=true&branch_id=...
 * - admin: all users (optional branch filter)
 * - manager: ONLY own branch, and ONLY operators (for safety)
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const requesterRole = req.user?.role;

    const roleFilter = typeof req.query.role === 'string' ? req.query.role.trim() : '';
    const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';

    if (roleFilter && !ALLOWED_ROLES.has(roleFilter)) {
      return badRequest(res, 'Invalid role filter');
    }

    const branchFilter = await getBranchFilterForList(req, res);
    if (branchFilter === undefined) return;

    const params: any[] = [branchFilter];
    let where = `WHERE ($1::uuid IS NULL OR branch_id = $1)`;

    if (roleFilter) {
      params.push(roleFilter);
      where += ` AND role = $${params.length}`;
    }

    if (!includeInactive) {
      where += ` AND is_active = true`;
    }

    // Manager safety: only show operators in their branch
    if (requesterRole === 'manager') {
      where += ` AND role = 'operator'`;
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
 * - admin: can create operator/manager/admin (branch required for operator/manager)
 * - manager: can ONLY create operator in own branch
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role;

    const email = normalizeEmail(req.body?.email);
    const password = normalizeText(req.body?.password, 200);
    const full_name = normalizeText(req.body?.full_name, 120);
    const role = normalizeText(req.body?.role, 20) || 'operator';
    const is_active = req.body?.is_active === undefined ? true : !!req.body.is_active;

    let branch_id = normalizeBranchId(req.body?.branch_id);
    if (branch_id === '__invalid__') return badRequest(res, 'branch_id must be a UUID');

    if (!email) return badRequest(res, 'Valid email is required');
    if (!password || password.length < 8) return badRequest(res, 'Password must be at least 8 characters');
    if (!ALLOWED_ROLES.has(role)) return badRequest(res, 'Invalid role');

    if (requesterRole === 'manager') {
      // manager is branch-scoped and should only create operators
      if (role !== 'operator') return forbidden(res, 'Managers can only create operator users');

      const own = requesterId ? await resolveUserBranchId(requesterId) : null;
      if (!own) return forbidden(res, 'Manager is not assigned to any branch');

      // If manager provided branch_id, it must match own; otherwise force it.
      if (branch_id && branch_id !== own) return forbidden(res, 'Managers cannot create users in another branch');
      branch_id = own;
    }

    // operators/managers MUST belong to a branch
    if (mustHaveBranch(role) && !branch_id) {
      return badRequest(res, 'branch_id is required for operator/manager users');
    }

    if (branch_id) {
      const ok = await ensureBranchExists(branch_id);
      if (!ok) return badRequest(res, 'branch_id does not exist');
    }

    const exists = await query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'User with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const created = await query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SAFE_USER_COLUMNS}`,
      [email, password_hash, full_name || null, role, is_active, branch_id]
    );

    try {
      await upsertUserProfileBranch(created.rows[0].id, branch_id);
    } catch (e: any) {
      console.warn('user_profiles sync failed (non-fatal)', { code: e?.code, message: e?.message });
    }

    return res.status(201).json({ success: true, data: created.rows[0] });
  } catch (error: any) {
    console.error('Create user error', { code: error?.code, message: error?.message });
    if (error?.code === '23505') return res.status(409).json({ success: false, error: 'Conflict' });
    return serverError(res);
  }
});

/**
 * PUT /api/users/:id
 * - admin: can update; cannot disable self; cannot change own role
 * - manager: can update ONLY operator users in own branch (no role/branch changes)
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role;

    if (requesterRole === 'manager' && requesterId === id) {
      // Keep it simple/safe: managers can’t edit themselves here
      return forbidden(res, 'Managers cannot update their own account here');
    }

    const full_name = req.body?.full_name === undefined ? undefined : normalizeText(req.body.full_name, 120);
    const role = req.body?.role === undefined ? undefined : normalizeText(req.body.role, 20);
    const is_active = req.body?.is_active === undefined ? undefined : !!req.body.is_active;
    const password = req.body?.password === undefined ? undefined : normalizeText(req.body.password, 200);

    const branch_id_raw = req.body?.branch_id === undefined ? undefined : normalizeBranchId(req.body?.branch_id);
    if (branch_id_raw === '__invalid__') return badRequest(res, 'branch_id must be a UUID');
    const branch_id = branch_id_raw; // undefined | string | null

    if (is_active === false && requesterId === id) {
      return forbidden(res, 'You cannot disable your own account');
    }
    if (role !== undefined && requesterId === id) {
      return forbidden(res, 'You cannot change your own role');
    }

    // Load existing user
    const existing = await query(`SELECT id, role, branch_id FROM users WHERE id = $1 LIMIT 1`, [id]);
    if (existing.rows.length === 0) return notFound(res, 'User not found');

    const existingRole = String(existing.rows[0].role || '');
    const existingBranchId = (existing.rows[0].branch_id as string | null) ?? null;

    // Manager scope checks
    if (requesterRole === 'manager') {
      const own = requesterId ? await resolveUserBranchId(requesterId) : null;
      if (!own) return forbidden(res, 'Manager is not assigned to any branch');

      if (existingBranchId !== own) return forbidden(res, 'You can only manage users in your branch');
      if (existingRole !== 'operator') return forbidden(res, 'Managers can only manage operator users');

      // Managers cannot change role or branch_id at all
      if (role !== undefined) return forbidden(res, 'Managers cannot change user roles');
      if (branch_id !== undefined) return forbidden(res, 'Managers cannot reassign branches');
    }

    // Admin validations
    if (role !== undefined) {
      if (!ALLOWED_ROLES.has(role)) return badRequest(res, 'Invalid role');
      // Admin-only actions are already enforced by requireRole, so no extra needed here
    }

    const newRole = role !== undefined ? role : existingRole;
    const newBranchId = branch_id !== undefined ? branch_id : existingBranchId;

    if (mustHaveBranch(newRole) && !newBranchId) {
      return badRequest(res, 'operator/manager users must have branch_id (cannot be null)');
    }

    if (newBranchId) {
      const ok = await ensureBranchExists(newBranchId);
      if (!ok) return badRequest(res, 'branch_id does not exist');
    }

    const fields: string[] = [];
    const params: any[] = [];
    let idx = 0;

    const pushField = (sql: string, val: any) => {
      idx += 1;
      fields.push(`${sql} = $${idx}`);
      params.push(val);
    };

    if (full_name !== undefined) pushField('full_name', full_name || null);
    if (role !== undefined) pushField('role', role);
    if (is_active !== undefined) pushField('is_active', is_active);
    if (branch_id !== undefined) pushField('branch_id', branch_id);

    if (password !== undefined) {
      if (!password || password.length < 8) return badRequest(res, 'Password must be at least 8 characters');
      const password_hash = await bcrypt.hash(password, 12);
      pushField('password_hash', password_hash);
    }

    if (fields.length === 0) return badRequest(res, 'No fields to update');

    fields.push(`updated_at = NOW()`);
    params.push(id);

    const updated = await query(
      `UPDATE users
       SET ${fields.join(', ')}
       WHERE id = $${params.length}
       RETURNING ${SAFE_USER_COLUMNS}`,
      params
    );

    if (branch_id !== undefined) {
      try {
        await upsertUserProfileBranch(id, branch_id);
      } catch (e: any) {
        console.warn('user_profiles sync failed (non-fatal)', { code: e?.code, message: e?.message });
      }
    }

    return res.json({ success: true, data: updated.rows[0] });
  } catch (error: any) {
    console.error('Update user error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * DELETE /api/users/:id  (soft delete)
 * - admin: can disable any (except self)
 * - manager: disabled (managers shouldn’t delete users)
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    if (req.user?.role === 'manager') {
      return forbidden(res, 'Managers cannot delete users');
    }

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
