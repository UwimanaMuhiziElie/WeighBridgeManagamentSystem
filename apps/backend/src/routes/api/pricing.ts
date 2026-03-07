// apps/backend/src/routes/api/pricing.ts
import { Router, Response } from 'express';
import { pool, query } from '../../db.js';
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

function parseBool(v: unknown, fallback = false) {
  const s = String(v ?? '').toLowerCase().trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return fallback;
}

function parseNumber(v: unknown, fallback: number | null = null): number | null {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function parseIntStrict(v: unknown, fallback: number | null = null): number | null {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'number') return Number.isInteger(v) ? v : fallback;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function parseISODate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
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
 * Pricing is branch-specific.
 * - admin: may use ?branch_id=...; else uses own assignment; if none => require branch_id
 * - manager/operator: forced to own branch; cannot switch
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

    if (role === 'admin') return requestedBranch;

    const own = await resolveUserBranchId(userId);
    if (!own) return forbidden(res, 'User is not assigned to any branch'), null;
    if (own !== requestedBranch) return forbidden(res, 'You cannot switch branch context'), null;
    return own;
  }

  const branchId = await resolveUserBranchId(userId);
  if (branchId) return branchId;

  if (role === 'admin') {
    return badRequest(res, 'branch_id is required for admin without a branch assignment'), null;
  }

  return forbidden(res, 'User is not assigned to any branch'), null;
}

/**
 * For write endpoints: branch_id can be passed in body (admin can target any branch).
 * - admin: body.branch_id optional (or query branch_id), else own assignment, else error
 * - manager: forced to own branch; if body.branch_id provided must match own
 */
async function getWriteBranchId(req: AuthRequest, res: Response, bodyBranchId?: unknown): Promise<string | null> {
  const role = req.user?.role;
  const userId = req.user?.id;
  if (!role || !userId) return forbidden(res, 'Unauthorized'), null;

  const bodyBid = typeof bodyBranchId === 'string' ? bodyBranchId.trim() : '';
  const queryBid = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';
  const requested = bodyBid || queryBid;

  if (requested) {
    if (!isUuid(requested)) return badRequest(res, 'Invalid branch_id'), null;

    if (role === 'admin') return requested;

    const own = await resolveUserBranchId(userId);
    if (!own) return forbidden(res, 'User is not assigned to any branch'), null;
    if (own !== requested) return forbidden(res, 'You cannot switch branch context'), null;
    return own;
  }

  const own = await resolveUserBranchId(userId);
  if (own) return own;

  if (role === 'admin') return badRequest(res, 'branch_id is required for admin without a branch assignment'), null;
  return forbidden(res, 'User is not assigned to any branch'), null;
}

const TIER_COLS = `
  id, branch_id, name, description,
  price_per_weighing, price_per_kg, minimum_charge,
  is_default, is_active, effective_from,
  created_at, updated_at
`;

const PT_TIER_COLS = `
  pt.id AS tier_id,
  pt.branch_id AS tier_branch_id,
  pt.name AS tier_name,
  pt.description AS tier_description,
  pt.price_per_weighing AS tier_price_per_weighing,
  pt.price_per_kg AS tier_price_per_kg,
  pt.minimum_charge AS tier_minimum_charge,
  pt.is_default AS tier_is_default,
  pt.is_active AS tier_is_active,
  pt.effective_from AS tier_effective_from,
  pt.created_at AS tier_created_at,
  pt.updated_at AS tier_updated_at
`;

/**
 * GET /api/pricing/tiers?include_inactive=true&branch_id=uuid (admin optional)
 */
router.get('/tiers', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
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
});

/**
 * GET /api/pricing/clients?limit=200&q=...
 */
router.get('/clients', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchId = await getScopedBranchId(req, res);
  if (!branchId) return;

  const limitRaw = parseIntStrict(req.query.limit, 200);
  const limit = Math.min(Math.max(limitRaw ?? 200, 1), 500);

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const like = q ? `%${q}%` : null;

  try {
    const r = await query(
      `
      SELECT id, company_name
      FROM clients
      WHERE branch_id = $1
        AND ($2::text IS NULL OR company_name ILIKE $2 OR id::text ILIKE $2)
      ORDER BY company_name ASC
      LIMIT $3
      `,
      [branchId, like, limit]
    );

    return res.json({ success: true, data: r.rows });
  } catch (error: any) {
    console.error('Get pricing clients error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * POST /api/pricing/tiers  (admin/manager)
 * P1: transaction for default switching + insert
 */
router.post('/tiers', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchId = await getWriteBranchId(req, res, (req.body as any)?.branch_id);
  if (!branchId) return;

  const body = req.body || {};
  const name = String((body as any).name || '').trim();
  const description = String((body as any).description || '').trim();

  const price_per_weighing = parseNumber((body as any).price_per_weighing, 0) ?? 0;
  const price_per_kg = parseNumber((body as any).price_per_kg, 0) ?? 0;
  const minimum_charge = parseNumber((body as any).minimum_charge, 0) ?? 0;

  const is_default = parseBool((body as any).is_default, false);
  const is_active = parseBool((body as any).is_active, true);

  const effective_from = parseISODate((body as any).effective_from) || new Date().toISOString().slice(0, 10);

  if (name.length < 2) return badRequest(res, 'name is required (min 2 chars)');
  if (price_per_weighing < 0 || price_per_kg < 0 || minimum_charge < 0) {
    return badRequest(res, 'Pricing fields cannot be negative');
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    if (is_default) {
      await db.query(`UPDATE pricing_tiers SET is_default = false WHERE branch_id = $1`, [branchId]);
    }

    const r = await db.query(
      `
      INSERT INTO pricing_tiers
        (branch_id, name, description, price_per_weighing, price_per_kg, minimum_charge, is_default, is_active, effective_from)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${TIER_COLS}
      `,
      [branchId, name, description, price_per_weighing, price_per_kg, minimum_charge, is_default, is_active, effective_from]
    );

    await db.query('COMMIT');
    return res.status(201).json({ success: true, data: r.rows[0] });
  } catch (error: any) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('Create pricing tier error', { code: error?.code, message: error?.message });
    return serverError(res);
  } finally {
    db.release();
  }
});

/**
 * PUT /api/pricing/tiers/:id  (admin/manager)
 * P1: transaction for default switching + update
 */
router.put('/tiers/:id', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const tierId = String(req.params.id || '').trim();
  if (!isUuid(tierId)) return badRequest(res, 'Invalid tier id');

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const existing = await db.query(`SELECT id, branch_id FROM pricing_tiers WHERE id = $1 LIMIT 1`, [tierId]);
    if (existing.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Tier not found' });
    }

    const existingBranch = String(existing.rows[0].branch_id);
    const branchId = await getWriteBranchId(req, res, existingBranch);
    if (!branchId) { await db.query('ROLLBACK'); return; }
    if (branchId !== existingBranch) { await db.query('ROLLBACK'); return forbidden(res, 'You cannot modify tiers outside your branch'); }

    const body = req.body || {};
    const name = String((body as any).name || '').trim();
    const description = String((body as any).description || '').trim();

    const price_per_weighing = parseNumber((body as any).price_per_weighing, 0) ?? 0;
    const price_per_kg = parseNumber((body as any).price_per_kg, 0) ?? 0;
    const minimum_charge = parseNumber((body as any).minimum_charge, 0) ?? 0;

    const is_default = parseBool((body as any).is_default, false);
    const is_active = parseBool((body as any).is_active, true);

    const effective_from = parseISODate((body as any).effective_from) || new Date().toISOString().slice(0, 10);

    if (name.length < 2) { await db.query('ROLLBACK'); return badRequest(res, 'name is required (min 2 chars)'); }
    if (price_per_weighing < 0 || price_per_kg < 0 || minimum_charge < 0) {
      await db.query('ROLLBACK');
      return badRequest(res, 'Pricing fields cannot be negative');
    }

    if (is_default) {
      await db.query(`UPDATE pricing_tiers SET is_default = false WHERE branch_id = $1`, [branchId]);
    }

    const r = await db.query(
      `
      UPDATE pricing_tiers
      SET
        name = $2,
        description = $3,
        price_per_weighing = $4,
        price_per_kg = $5,
        minimum_charge = $6,
        is_default = $7,
        is_active = $8,
        effective_from = $9,
        updated_at = NOW()
      WHERE id = $1
      RETURNING ${TIER_COLS}
      `,
      [tierId, name, description, price_per_weighing, price_per_kg, minimum_charge, is_default, is_active, effective_from]
    );

    await db.query('COMMIT');
    return res.json({ success: true, data: r.rows[0] });
  } catch (error: any) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('Update pricing tier error', { code: error?.code, message: error?.message });
    return serverError(res);
  } finally {
    db.release();
  }
});

/**
 * PATCH /api/pricing/tiers/:id/status  { is_active: boolean }
 */
router.patch('/tiers/:id/status', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const tierId = String(req.params.id || '').trim();
  if (!isUuid(tierId)) return badRequest(res, 'Invalid tier id');

  const is_active = parseBool((req.body as any)?.is_active, true);

  try {
    const existing = await query(`SELECT id, branch_id FROM pricing_tiers WHERE id = $1 LIMIT 1`, [tierId]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, error: 'Tier not found' });

    const branchId = await getWriteBranchId(req, res, existing.rows[0].branch_id);
    if (!branchId) return;
    if (branchId !== existing.rows[0].branch_id) return forbidden(res, 'Forbidden');

    const r = await query(
      `
      UPDATE pricing_tiers
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING ${TIER_COLS}
      `,
      [tierId, is_active]
    );

    return res.json({ success: true, data: r.rows[0] });
  } catch (error: any) {
    console.error('Update tier status error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * PATCH /api/pricing/tiers/:id/default
 * P1: transaction for clearing + setting default
 */
router.patch('/tiers/:id/default', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const tierId = String(req.params.id || '').trim();
  if (!isUuid(tierId)) return badRequest(res, 'Invalid tier id');

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const existing = await db.query(`SELECT id, branch_id FROM pricing_tiers WHERE id = $1 LIMIT 1`, [tierId]);
    if (existing.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Tier not found' });
    }

    const branchId = String(existing.rows[0].branch_id);
    const allowedBranch = await getWriteBranchId(req, res, branchId);
    if (!allowedBranch) { await db.query('ROLLBACK'); return; }
    if (allowedBranch !== branchId) { await db.query('ROLLBACK'); return forbidden(res, 'Forbidden'); }

    await db.query(`UPDATE pricing_tiers SET is_default = false WHERE branch_id = $1`, [branchId]);
    const r = await db.query(
      `
      UPDATE pricing_tiers
      SET is_default = true, updated_at = NOW()
      WHERE id = $1
      RETURNING ${TIER_COLS}
      `,
      [tierId]
    );

    await db.query('COMMIT');
    return res.json({ success: true, data: r.rows[0] });
  } catch (error: any) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('Set default tier error', { code: error?.code, message: error?.message });
    return serverError(res);
  } finally {
    db.release();
  }
});

/**
 * GET /api/pricing/client/:clientId
 */
router.get('/client/:clientId', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchId = await getScopedBranchId(req, res);
  if (!branchId) return;

  const clientId = String(req.params.clientId || '').trim();
  if (!isUuid(clientId)) return badRequest(res, 'clientId must be a UUID');

  try {
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
        ${PT_TIER_COLS}
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
});

/**
 * PUT /api/pricing/client/:clientId
 * FIXED: prevents overlaps with FUTURE overrides.
 * - If effective_until is not provided and a future override exists, auto-close to (next_from - 1 day).
 * - If effective_until is provided and overlaps a future override, reject.
 */
router.put('/client/:clientId', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchId = await getScopedBranchId(req, res);
  if (!branchId) return;

  const clientId = String(req.params.clientId || '').trim();
  if (!isUuid(clientId)) return badRequest(res, 'clientId must be a UUID');

  const body: any = req.body || {};

  const pricing_tier_id = body.pricing_tier_id ? String(body.pricing_tier_id).trim() : null;
  if (pricing_tier_id && !isUuid(pricing_tier_id)) return badRequest(res, 'pricing_tier_id must be a UUID');

  const price_per_weighing = parseNumber(body.price_per_weighing, null);
  const price_per_kg = parseNumber(body.price_per_kg, null);
  const minimum_charge = parseNumber(body.minimum_charge, null);

  const discount_percentage = parseIntStrict(body.discount_percentage, 0) ?? 0;

  const effective_from = parseISODate(body.effective_from) || new Date().toISOString().slice(0, 10);
  const effective_until_input = parseISODate(body.effective_until);

  if (discount_percentage < 0 || discount_percentage > 100) return badRequest(res, 'discount_percentage must be 0..100');
  if ((price_per_weighing ?? 0) < 0 || (price_per_kg ?? 0) < 0 || (minimum_charge ?? 0) < 0) {
    return badRequest(res, 'Pricing fields cannot be negative');
  }
  if (effective_until_input && effective_until_input < effective_from) {
    return badRequest(res, 'effective_until cannot be before effective_from');
  }

  // Require some override intent
  const hasAnyOverride =
    !!pricing_tier_id ||
    price_per_weighing !== null ||
    price_per_kg !== null ||
    minimum_charge !== null ||
    discount_percentage !== 0;

  if (!hasAnyOverride) {
    return badRequest(res, 'Provide pricing_tier_id OR at least one price field OR a discount_percentage');
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    // Ensure client belongs to branch
    const c = await db.query(`SELECT id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [clientId, branchId]);
    if (c.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    // Ensure tier belongs to branch (if set)
    if (pricing_tier_id) {
      const t = await db.query(`SELECT id FROM pricing_tiers WHERE id = $1 AND branch_id = $2 LIMIT 1`, [pricing_tier_id, branchId]);
      if (t.rows.length === 0) {
        await db.query('ROLLBACK');
        return badRequest(res, 'pricing_tier_id not found for this branch');
      }
    }

    // Remove duplicates on same effective_from
    await db.query(
      `DELETE FROM client_pricing
       WHERE client_id = $1 AND effective_from = $2::date`,
      [clientId, effective_from]
    );

    // Close currently-active override(s) as of effective_from (strictly earlier starts)
    await db.query(
      `
      UPDATE client_pricing
      SET effective_until = (($2::date - INTERVAL '1 day')::date), updated_at = NOW()
      WHERE client_id = $1
        AND effective_from < $2::date
        AND (effective_until IS NULL OR effective_until >= $2::date)
      `,
      [clientId, effective_from]
    );

    // NEW: check NEXT override (future) to avoid overlap
    const next = await db.query(
      `
      SELECT
        effective_from AS next_from,
        ((effective_from - INTERVAL '1 day')::date) AS auto_until
      FROM client_pricing
      WHERE client_id = $1
        AND effective_from > $2::date
      ORDER BY effective_from ASC
      LIMIT 1
      `,
      [clientId, effective_from]
    );

    const next_from: string | null = next.rows?.[0]?.next_from ? new Date(next.rows[0].next_from).toISOString().slice(0, 10) : null;
    const auto_until: string | null = next.rows?.[0]?.auto_until ? new Date(next.rows[0].auto_until).toISOString().slice(0, 10) : null;

    // Decide final effective_until
    let effective_until_final: string | null = effective_until_input || null;

    if (next_from) {
      if (effective_until_final) {
        // If user specified an end date, it must end BEFORE next_from
        if (effective_until_final >= next_from) {
          await db.query('ROLLBACK');
          return badRequest(res, `effective_until overlaps an existing future override starting ${next_from}`);
        }
      } else {
        // If user didn't specify an end date, auto-close to day before next_from
        effective_until_final = auto_until;
      }
    }

    const ins = await db.query(
      `
      INSERT INTO client_pricing
        (client_id, pricing_tier_id, price_per_weighing, price_per_kg, minimum_charge, discount_percentage, effective_from, effective_until)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7::date, $8::date)
      RETURNING
        id, client_id, pricing_tier_id,
        price_per_weighing, price_per_kg, minimum_charge, discount_percentage,
        effective_from, effective_until, created_at, updated_at
      `,
      [
        clientId,
        pricing_tier_id,
        price_per_weighing,
        price_per_kg,
        minimum_charge,
        discount_percentage,
        effective_from,
        effective_until_final,
      ]
    );

    const joined = await db.query(
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
        ${PT_TIER_COLS}
      FROM client_pricing cp
      LEFT JOIN pricing_tiers pt ON pt.id = cp.pricing_tier_id
      WHERE cp.id = $1
      LIMIT 1
      `,
      [ins.rows[0].id]
    );

    await db.query('COMMIT');
    return res.json({ success: true, data: joined.rows[0] || ins.rows[0] });
  } catch (error: any) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('Upsert client pricing error', { code: error?.code, message: error?.message });
    return serverError(res);
  } finally {
    db.release();
  }
});

/**
 * DELETE /api/pricing/client/:clientId
 * Clears current override (ends it yesterday).
 */
router.delete('/client/:clientId', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchId = await getScopedBranchId(req, res);
  if (!branchId) return;

  const clientId = String(req.params.clientId || '').trim();
  if (!isUuid(clientId)) return badRequest(res, 'clientId must be a UUID');

  try {
    const c = await query(`SELECT id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [clientId, branchId]);
    if (c.rows.length === 0) return res.status(404).json({ success: false, error: 'Client not found' });

    const r = await query(
      `
      UPDATE client_pricing
      SET effective_until = ((CURRENT_DATE - INTERVAL '1 day')::date), updated_at = NOW()
      WHERE client_id = $1
        AND effective_from <= CURRENT_DATE
        AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
      RETURNING id
      `,
      [clientId]
    );

    return res.json({ success: true, data: { cleared: r.rows.length } });
  } catch (error: any) {
    console.error('Clear client pricing error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

export default router;
