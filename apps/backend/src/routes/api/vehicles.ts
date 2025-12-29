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

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/** Branch resolution (same pattern as other routes), will come back on this later! */
async function resolveUserBranchId(userId: string): Promise<string | null> {
  try {
    const r1 = await query(`SELECT branch_id FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r1.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  try {
    const r2 = await query(`SELECT branch_id FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    const bid = r2.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  try {
    const r3 = await query(`SELECT branch_id FROM user_profiles WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r3.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  return null;
}

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

  if (role === 'admin' || role === 'manager') {
    return badRequest(res, 'branch_id is required for admin/manager without a branch assignment'), null;
  }

  return forbidden(res, 'User is not assigned to any branch'), null;
}

// Vehicles are branch-scoped via clients.branch_id (vehicles table has no branch_id)
const VEHICLE_COLUMNS = `
  v.id,
  v.client_id,
  v.license_plate,
  v.vehicle_type,
  v.make,
  v.model,
  v.year,
  v.tare_weight,
  v.max_capacity,
  v.notes,
  v.is_active,
  v.created_at,
  v.updated_at
`;

/**
 * GET /api/vehicles?client_id=<uuid>&include_inactive=true&limit=200&offset=0
 * - operator/admin/manager can read (branch-scoped)
 */
router.get(
  '/',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    try {
      const branchId = await getScopedBranchId(req, res);
      if (!branchId) return;

      const clientId = typeof req.query.client_id === 'string' ? req.query.client_id.trim() : '';
      if (clientId && !isUuid(clientId)) return badRequest(res, 'client_id must be a UUID');

      const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';

      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 200;
      const offsetRaw = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;

      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 200;
      const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

      const result = await query(
        `
        SELECT ${VEHICLE_COLUMNS},
               c.company_name as client_name
        FROM vehicles v
        JOIN clients c ON c.id = v.client_id
        WHERE c.branch_id = $1
          AND ($2::uuid IS NULL OR v.client_id = $2)
          AND ($3::boolean OR v.is_active = true)
        ORDER BY v.license_plate ASC
        LIMIT $4 OFFSET $5
        `,
        [branchId, clientId ? clientId : null, includeInactive, limit, offset]
      );

      return res.json({ success: true, data: result.rows });
    } catch (error: any) {
      console.error('Get vehicles error', { code: error?.code, message: error?.message });
      return serverError(res);
    }
  }
);

export default router;
