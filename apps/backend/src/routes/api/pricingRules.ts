// apps/backend/src/routes/api/pricingRules.ts
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

function normalizeText(v: unknown, maxLen = 255): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function parseIntStrict(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function parseISODateStrict(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * ✅ UPDATED: allow non-weight units used by UI:
 * kg/ton/lb = weight-based
 * item/mattress/count = quantity-based
 */
const ALLOWED_UNIT_TYPES = ['kg', 'ton', 'lb', 'item', 'mattress', 'count'] as const;
type UnitType = (typeof ALLOWED_UNIT_TYPES)[number];
const UNIT_SET = new Set<string>(ALLOWED_UNIT_TYPES);

function parseUnitType(v: unknown): UnitType | null {
  const s = normalizeText(v, 20);
  if (!s) return 'kg'; // default
  const lower = s.toLowerCase();
  if (!UNIT_SET.has(lower)) return null;
  return lower as UnitType;
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

async function getBranchFilterForList(req: AuthRequest, res: Response): Promise<string | null | undefined> {
  const userId = req.user?.id;
  const role = req.user?.role;

  if (!userId || !role) {
    forbidden(res, 'Unauthorized');
    return undefined;
  }

  const requestedBranch = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';
  const own = await resolveUserBranchId(userId);

  if (role === 'admin') {
    if (requestedBranch) {
      if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), undefined;
      return requestedBranch;
    }
    return null; // all branches
  }

  if (!own) return forbidden(res, 'User is not assigned to any branch'), undefined;

  if (requestedBranch) {
    if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), undefined;
    if (requestedBranch !== own) return forbidden(res, 'You cannot switch branch context'), undefined;
  }

  return own;
}

async function getBranchIdForWrite(req: AuthRequest, res: Response, bodyBranchId?: unknown): Promise<string | null> {
  const userId = req.user?.id;
  const role = req.user?.role;
  if (!userId || !role) return forbidden(res, 'Unauthorized'), null;

  const bodyBid = typeof bodyBranchId === 'string' ? bodyBranchId.trim() : '';
  const queryBid = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';
  const requested = bodyBid || queryBid;

  const own = await resolveUserBranchId(userId);

  if (role === 'admin') {
    if (requested) {
      if (!isUuid(requested)) return badRequest(res, 'Invalid branch_id'), null;
      return requested;
    }
    if (own) return own;
    return badRequest(res, 'branch_id is required for admin without a branch assignment'), null;
  }

  // manager
  if (!own) return forbidden(res, 'User is not assigned to any branch'), null;
  if (requested) {
    if (!isUuid(requested)) return badRequest(res, 'Invalid branch_id'), null;
    if (requested !== own) return forbidden(res, 'You cannot switch branch context'), null;
  }
  return own;
}

function mapDbError(res: Response, e: any) {
  const code = String(e?.code || '');
  const msg = String(e?.message || '');

  if (code === '23514') {
    if (msg.toLowerCase().includes('unit_type')) {
      return badRequest(res, `unit_type must be one of: 'kg', 'ton', 'lb', 'item', 'mattress', 'count'`);
    }
    return badRequest(res, 'Invalid value (constraint check failed)');
  }

  if (code === '23502') {
    return badRequest(res, 'Missing required field');
  }

  if (code === '22P02') {
    return badRequest(res, 'Invalid input format');
  }

  console.error('DB error', { code, message: msg });
  return serverError(res);
}

/**
 * GET /api/pricingRules
 */
router.get('/', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  try {
    const limitRaw = parseIntStrict(req.query.limit);
    const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    const activeParam = String(req.query.active ?? 'true').toLowerCase();
    const active = activeParam === 'true' ? true : activeParam === 'false' ? false : true;

    const branchFilter = await getBranchFilterForList(req, res);
    if (branchFilter === undefined) return;

    const q = typeof req.query.q === 'string' ? normalizeText(req.query.q, 120) : '';
    const hasQ = q.length > 0;
    const like = hasQ ? `%${q}%` : null;

    const params: any[] = [branchFilter, active];
    let where = `WHERE ($1::uuid IS NULL OR branch_id = $1) AND is_active = $2`;

    if (hasQ) {
      where += ` AND (
        name ILIKE $3
        OR COALESCE(material_type,'') ILIKE $3
        OR COALESCE(vehicle_type,'') ILIKE $3
        OR COALESCE(unit_type,'') ILIKE $3
      )`;
      params.push(like);
    }

    params.push(limit);

    const sql = `
      SELECT
        id, branch_id, name, material_type, client_id, vehicle_type,
        min_weight, max_weight, price_per_unit, unit_type,
        is_active, priority, effective_from, effective_until, created_at, updated_at
      FROM pricing_rules
      ${where}
      ORDER BY priority DESC, created_at DESC
      LIMIT $${params.length}
    `;

    const r = await query(sql, params);
    return res.json({ success: true, data: r.rows });
  } catch (e: any) {
    console.error('Get pricing rules error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

/**
 * POST /api/pricingRules
 */
router.post('/', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchId = await getBranchIdForWrite(req, res, (req.body as any)?.branch_id);
  if (!branchId) return;

  const b: any = req.body || {};

  const name = normalizeText(b.name, 120);
  if (name.length < 2) return badRequest(res, 'name is required (min 2 chars)');

  const material_type = normalizeText(b.material_type, 80) || null;
  const vehicle_type = normalizeText(b.vehicle_type, 80) || null;

  const client_id = b.client_id ? String(b.client_id).trim() : null;
  if (client_id && !isUuid(client_id)) return badRequest(res, 'client_id must be a UUID');

  const min_weight = parseNumber(b.min_weight);
  const max_weight = parseNumber(b.max_weight);

  const price_per_unit = parseNumber(b.price_per_unit);
  if (price_per_unit === null || price_per_unit < 0) return badRequest(res, 'price_per_unit is required and must be >= 0');

  const unit_type = parseUnitType(b.unit_type);
  if (!unit_type) return badRequest(res, `unit_type must be one of: 'kg', 'ton', 'lb', 'item', 'mattress', 'count'`);

  const priority = parseIntStrict(b.priority) ?? 0;

  const is_active_raw = b.is_active;
  const is_active = is_active_raw === undefined ? true : (typeof is_active_raw === 'boolean' ? is_active_raw : null);
  if (is_active === null) return badRequest(res, 'is_active must be a boolean');

  const effective_from_input = b.effective_from;
  const effective_from =
    effective_from_input === undefined || effective_from_input === null || String(effective_from_input).trim() === ''
      ? todayISO()
      : parseISODateStrict(effective_from_input);

  if (!effective_from) return badRequest(res, 'effective_from must be in YYYY-MM-DD format');

  const effective_until_input = b.effective_until;
  const effective_until =
    effective_until_input === undefined || effective_until_input === null || String(effective_until_input).trim() === ''
      ? null
      : parseISODateStrict(effective_until_input);

  if (effective_until_input && !effective_until) return badRequest(res, 'effective_until must be in YYYY-MM-DD format');

  if (min_weight !== null && max_weight !== null && min_weight > max_weight) {
    return badRequest(res, 'min_weight cannot be greater than max_weight');
  }
  if (effective_until && effective_until < effective_from) {
    return badRequest(res, 'effective_until cannot be before effective_from');
  }

  try {
    if (client_id) {
      const c = await query(`SELECT id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [client_id, branchId]);
      if (c.rows.length === 0) return badRequest(res, 'client_id not found for this branch');
    }

    const r = await query(
      `
      INSERT INTO pricing_rules
        (branch_id, name, material_type, client_id, vehicle_type, min_weight, max_weight, price_per_unit, unit_type, is_active, priority, effective_from, effective_until)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13::date)
      RETURNING
        id, branch_id, name, material_type, client_id, vehicle_type,
        min_weight, max_weight, price_per_unit, unit_type, is_active, priority,
        effective_from, effective_until, created_at, updated_at
      `,
      [
        branchId,
        name,
        material_type,
        client_id,
        vehicle_type,
        min_weight,
        max_weight,
        price_per_unit,
        unit_type,
        is_active,
        priority,
        effective_from,
        effective_until,
      ]
    );

    return res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e: any) {
    console.error('Create pricing rule error', { code: e?.code, message: e?.message });
    return mapDbError(res, e);
  }
});

/**
 * PUT /api/pricingRules/:id
 */
router.put('/:id', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const ruleId = String(req.params.id || '').trim();
  if (!isUuid(ruleId)) return badRequest(res, 'Invalid rule id');

  try {
    const existing = await query(`SELECT id, branch_id FROM pricing_rules WHERE id = $1 LIMIT 1`, [ruleId]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, error: 'Rule not found' });

    const branchId = await getBranchIdForWrite(req, res, existing.rows[0].branch_id);
    if (!branchId) return;
    if (String(existing.rows[0].branch_id) !== branchId) return forbidden(res, 'Forbidden');

    const b: any = req.body || {};

    const name = normalizeText(b.name, 120);
    if (name.length < 2) return badRequest(res, 'name is required (min 2 chars)');

    const material_type = normalizeText(b.material_type, 80) || null;
    const vehicle_type = normalizeText(b.vehicle_type, 80) || null;

    const client_id = b.client_id ? String(b.client_id).trim() : null;
    if (client_id && !isUuid(client_id)) return badRequest(res, 'client_id must be a UUID');

    const min_weight = parseNumber(b.min_weight);
    const max_weight = parseNumber(b.max_weight);

    const price_per_unit = parseNumber(b.price_per_unit);
    if (price_per_unit === null || price_per_unit < 0) return badRequest(res, 'price_per_unit is required and must be >= 0');

    const unit_type = parseUnitType(b.unit_type);
    if (!unit_type) return badRequest(res, `unit_type must be one of: 'kg', 'ton', 'lb', 'item', 'mattress', 'count'`);

    const priority = parseIntStrict(b.priority) ?? 0;

    const is_active_raw = b.is_active;
    const is_active = is_active_raw === undefined ? true : (typeof is_active_raw === 'boolean' ? is_active_raw : null);
    if (is_active === null) return badRequest(res, 'is_active must be a boolean');

    const effective_from_input = b.effective_from;
    const effective_from =
      effective_from_input === undefined || effective_from_input === null || String(effective_from_input).trim() === ''
        ? todayISO()
        : parseISODateStrict(effective_from_input);
    if (!effective_from) return badRequest(res, 'effective_from must be in YYYY-MM-DD format');

    const effective_until_input = b.effective_until;
    const effective_until =
      effective_until_input === undefined || effective_until_input === null || String(effective_until_input).trim() === ''
        ? null
        : parseISODateStrict(effective_until_input);
    if (effective_until_input && !effective_until) return badRequest(res, 'effective_until must be in YYYY-MM-DD format');

    if (min_weight !== null && max_weight !== null && min_weight > max_weight) {
      return badRequest(res, 'min_weight cannot be greater than max_weight');
    }
    if (effective_until && effective_until < effective_from) {
      return badRequest(res, 'effective_until cannot be before effective_from');
    }

    if (client_id) {
      const c = await query(`SELECT id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [client_id, branchId]);
      if (c.rows.length === 0) return badRequest(res, 'client_id not found for this branch');
    }

    const r = await query(
      `
      UPDATE pricing_rules
      SET
        name = $2,
        material_type = $3,
        client_id = $4,
        vehicle_type = $5,
        min_weight = $6,
        max_weight = $7,
        price_per_unit = $8,
        unit_type = $9,
        is_active = $10,
        priority = $11,
        effective_from = $12::date,
        effective_until = $13::date,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id, branch_id, name, material_type, client_id, vehicle_type,
        min_weight, max_weight, price_per_unit, unit_type, is_active, priority,
        effective_from, effective_until, created_at, updated_at
      `,
      [
        ruleId,
        name,
        material_type,
        client_id,
        vehicle_type,
        min_weight,
        max_weight,
        price_per_unit,
        unit_type,
        is_active,
        priority,
        effective_from,
        effective_until,
      ]
    );

    return res.json({ success: true, data: r.rows[0] });
  } catch (e: any) {
    console.error('Update pricing rule error', { code: e?.code, message: e?.message });
    return mapDbError(res, e);
  }
});

/**
 * PATCH /api/pricingRules/:id/status
 */
router.patch('/:id/status', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const ruleId = String(req.params.id || '').trim();
  if (!isUuid(ruleId)) return badRequest(res, 'Invalid rule id');

  const is_active_raw = (req.body as any)?.is_active;
  if (typeof is_active_raw !== 'boolean') return badRequest(res, 'is_active must be a boolean');

  try {
    const existing = await query(`SELECT id, branch_id FROM pricing_rules WHERE id = $1 LIMIT 1`, [ruleId]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, error: 'Rule not found' });

    const branchId = await getBranchIdForWrite(req, res, existing.rows[0].branch_id);
    if (!branchId) return;
    if (String(existing.rows[0].branch_id) !== branchId) return forbidden(res, 'Forbidden');

    const r = await query(
      `
      UPDATE pricing_rules
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING
        id, branch_id, name, material_type, client_id, vehicle_type,
        min_weight, max_weight, price_per_unit, unit_type, is_active, priority,
        effective_from, effective_until, created_at, updated_at
      `,
      [ruleId, is_active_raw]
    );

    return res.json({ success: true, data: r.rows[0] });
  } catch (e: any) {
    console.error('Update pricing rule status error', { code: e?.code, message: e?.message });
    return mapDbError(res, e);
  }
});

/**
 * DELETE /api/pricingRules/:id
 */
router.delete('/:id', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const ruleId = String(req.params.id || '').trim();
  if (!isUuid(ruleId)) return badRequest(res, 'Invalid rule id');

  try {
    const existing = await query(`SELECT id, branch_id FROM pricing_rules WHERE id = $1 LIMIT 1`, [ruleId]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, error: 'Rule not found' });

    const branchId = await getBranchIdForWrite(req, res, existing.rows[0].branch_id);
    if (!branchId) return;
    if (String(existing.rows[0].branch_id) !== branchId) return forbidden(res, 'Forbidden');

    await query(`DELETE FROM pricing_rules WHERE id = $1`, [ruleId]);
    return res.json({ success: true, data: { deleted: true } });
  } catch (e: any) {
    console.error('Delete pricing rule error', { code: e?.code, message: e?.message });
    return mapDbError(res, e);
  }
});

export default router;
