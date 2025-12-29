import { Router, Response } from 'express';
import { query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

const router = Router();

// JWT-protected
router.use(authenticate);

function badRequest(res: Response, message: string) {
  return res.status(400).json({ success: false, error: message });
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

function normalizeNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

// Avoid SELECT * to reduce accidental leakage.
const CLIENT_COLUMNS = `
  id,
  branch_id,
  company_name,
  contact_person,
  phone,
  email,
  address,
  tax_id,
  credit_limit,
  payment_terms,
  notes,
  is_active,
  created_at,
  updated_at
`;

/**
 * Resolve the authenticated user's branch_id.
 * NOTE: Once you confirm schema, keep ONLY the correct query to avoid extra DB round-trips.
 */
async function resolveUserBranchId(userId: string): Promise<string | null> {
  // 1) users.branch_id
  try {
    const r1 = await query(`SELECT branch_id FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r1.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  // 2) user_profiles.user_id -> branch_id
  try {
    const r2 = await query(`SELECT branch_id FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    const bid = r2.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  // 3) user_profiles.id == users.id -> branch_id
  try {
    const r3 = await query(`SELECT branch_id FROM user_profiles WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r3.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  return null;
}

/**
 * Branch scoping:
 * - operator: must be assigned to a branch, cannot switch
 * - admin/manager: may pass ?branch_id=...; if not assigned, must pass it
 */
async function getScopedBranchId(req: AuthRequest, res: Response): Promise<string | null> {
  const userId = req.user?.id;
  const role = req.user?.role;

  if (!userId || !role) {
    forbidden(res, 'Unauthorized');
    return null;
  }

  const requestedBranch = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';
  if (requestedBranch) {
    if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), null;
    if (role === 'admin' || role === 'manager') return requestedBranch;
    return forbidden(res, 'Operators cannot switch branch context'), null;
  }

  const branchId = await resolveUserBranchId(userId);
  if (branchId) return branchId;

  // Production-safe behavior: admin/manager must specify branch_id if not assigned
  if (role === 'admin' || role === 'manager') {
    return badRequest(res, 'branch_id is required for admin/manager without a branch assignment'), null;
  }

  return forbidden(res, 'User is not assigned to any branch'), null;
}

/**
 * GET /api/clients?include_inactive=true&limit=100&offset=0
 * - operator/admin/manager can read (operators locked to their branch)
 */
router.get(
  '/',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    try {
      const branchId = await getScopedBranchId(req, res);
      if (!branchId) return;

      const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';

      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
      const offsetRaw = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;

      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;
      const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

      const result = await query(
        `SELECT ${CLIENT_COLUMNS}
         FROM clients
         WHERE branch_id = $1
           AND ($2::boolean OR is_active = true)
         ORDER BY company_name
         LIMIT $3 OFFSET $4`,
        [branchId, includeInactive, limit, offset]
      );

      return res.json({ success: true, data: result.rows });
    } catch (error: any) {
      console.error('Get clients error', { code: error?.code });
      return serverError(res);
    }
  }
);

/**
 * POST /api/clients
 * - Only admin/manager can create clients
 */
router.post(
  '/',
  requireRole(['admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    try {
      const branchId = await getScopedBranchId(req, res);
      if (!branchId) return;

      const company_name = normalizeText(req.body?.company_name, 200);
      const contact_person = normalizeText(req.body?.contact_person, 200);
      const phone = normalizeText(req.body?.phone, 50);
      const email = normalizeEmail(req.body?.email);

      if (!company_name) return badRequest(res, 'company_name is required');
      if (!contact_person) return badRequest(res, 'contact_person is required');
      if (!phone) return badRequest(res, 'phone is required');
      if (!email) return badRequest(res, 'email is required');

      const address = normalizeText(req.body?.address, 500);
      const tax_id = normalizeText(req.body?.tax_id, 100);
      const payment_terms = normalizeText(req.body?.payment_terms, 50) || 'Net 30';
      const notes = normalizeText(req.body?.notes, 2000);

      const credit_limit = normalizeNumber(req.body?.credit_limit, 0);
      if (credit_limit < 0) return badRequest(res, 'credit_limit must be >= 0');

      // Pre-check (still keep unique constraint in DB for real protection)
      const exists = await query(
        `SELECT id FROM clients WHERE branch_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
        [branchId, email]
      );
      if (exists.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Client with this email already exists in this branch',
        });
      }

      const result = await query(
        `INSERT INTO clients
         (branch_id, company_name, contact_person, phone, email, address, tax_id, credit_limit, payment_terms, notes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
         RETURNING ${CLIENT_COLUMNS}`,
        [
          branchId,
          company_name,
          contact_person,
          phone,
          email,
          address,
          tax_id,
          credit_limit,
          payment_terms,
          notes,
        ]
      );

      return res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error: any) {
      if (error?.code === '23505') {
        return res.status(409).json({ success: false, error: 'Conflict' });
      }
      console.error('Create client error', { code: error?.code });
      return serverError(res);
    }
  }
);

export default router;
