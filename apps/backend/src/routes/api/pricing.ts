import { Router, Response } from 'express';
import { query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

const router = Router();
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

const TIER_COLS = `
  id, branch_id, name, description,
  price_per_weighing, price_per_kg, minimum_charge,
  is_default, is_active, effective_from,
  created_at, updated_at
`;

/**
 * GET /api/pricing/tiers?include_inactive=true
 */
router.get(
  '/tiers',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    const branchId = await getScopedBranchId(req, res);
    if (!branchId) return;

    const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';

    try {
      const r = await query(
        `
        SELECT ${TIER_COLS}
        FROM pricing_tiers
        WHERE branch_id = $1
          AND ($2::boolean OR is_active = true)
        ORDER BY is_default DESC, name ASC
        `,
        [branchId, includeInactive]
      );

      return res.json({ success: true, data: r.rows });
    } catch (error: any) {
      console.error('Get pricing tiers error', { code: error?.code, message: error?.message });
      return serverError(res);
    }
  }
);

/**
 * GET /api/pricing/client/:clientId
 * Returns current pricing for a client (override + tier).
 */
router.get(
  '/client/:clientId',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    const branchId = await getScopedBranchId(req, res);
    if (!branchId) return;

    const clientId = String(req.params.clientId || '').trim();
    if (!isUuid(clientId)) return badRequest(res, 'clientId must be a UUID');

    try {
      // Ensure client belongs to branch
      const c = await query(`SELECT id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [clientId, branchId]);
      if (c.rows.length === 0) return res.status(404).json({ success: false, error: 'Client not found' });

      const defaultTier = await query(
        `
        SELECT ${TIER_COLS}
        FROM pricing_tiers
        WHERE branch_id = $1
          AND is_active = true
          AND effective_from <= CURRENT_DATE
        ORDER BY is_default DESC, effective_from DESC
        LIMIT 1
        `,
        [branchId]
      );

      const override = await query(
        `
        SELECT
          cp.id,
          cp.client_id,
          cp.pricing_tier_id,
          cp.price_per_weighing,
          cp.price_per_kg,
          cp.minimum_charge,
          cp.discount_percentage,
          cp.effective_from,
          cp.effective_until,
          cp.created_at,
          cp.updated_at,
          pt.${TIER_COLS}
        FROM client_pricing cp
        LEFT JOIN pricing_tiers pt ON pt.id = cp.pricing_tier_id
        WHERE cp.client_id = $1
          AND cp.effective_from <= CURRENT_DATE
          AND (cp.effective_until IS NULL OR cp.effective_until >= CURRENT_DATE)
        ORDER BY cp.effective_from DESC
        LIMIT 1
        `,
        [clientId]
      );

      return res.json({
        success: true,
        data: {
          defaultTier: defaultTier.rows[0] || null,
          clientPricing: override.rows[0] || null,
        },
      });
    } catch (error: any) {
      console.error('Get client pricing error', { code: error?.code, message: error?.message });
      return serverError(res);
    }
  }
);

export default router;
