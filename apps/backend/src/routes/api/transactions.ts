// apps/backend/src/routes/api/transactions.ts
import { Router, Response } from 'express';
import { pool, query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';
import { resolvePricing } from '../../services/pricing.js';

const router = Router();
router.use(authenticate);

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

function parseIntStrict(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseNumberStrict(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes';
}

function parseISODate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function escapeLike(input: string) {
  return input.replace(/[%_\\]/g, (m) => `\\${m}`);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// DB schema allows inbound/outbound only (UI shows Scale-In/Scale-Out)
const ALLOWED_TRANSACTION_TYPES = new Set(['inbound', 'outbound']);
const ALLOWED_STATUS_FILTERS = new Set(['pending', 'in_progress', 'completed', 'cancelled']);

// Team lead requirement: always 5% GST
const GST_RATE = 5;

// advisory lock namespace for yearly invoice number generation
const INVOICE_NO_LOCK_NS = 91001;

// ----- branch scoping helpers -----
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
 * LIST branch filter:
 * - admin: ALL branches by default; optional ?branch_id=...
 * - manager/operator: forced to own branch; cannot switch
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
      forbidden(res, 'User is not assigned to any branch');
      return undefined;
    }
    if (own !== requestedBranch) {
      forbidden(res, 'You cannot switch branch context');
      return undefined;
    }
    return own;
  }

  if (role === 'admin') return null;

  const own = await resolveUserBranchId(userId);
  if (!own) {
    forbidden(res, 'User is not assigned to any branch');
    return undefined;
  }
  return own;
}

/**
 * WRITE branch scoping:
 * - admin: may set ?branch_id=...; else uses own assignment; if none => error
 * - manager/operator: forced to own branch; cannot switch
 */
async function getScopedBranchIdForWrite(req: AuthRequest, res: Response): Promise<string | null> {
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

  const own = await resolveUserBranchId(userId);
  if (own) return own;

  if (role === 'admin') {
    return badRequest(res, 'branch_id is required for admin without a branch assignment'), null;
  }

  return forbidden(res, 'User is not assigned to any branch'), null;
}

/**
 * For actions on an existing transaction (like :id/complete),
 * admin derives branch from the transaction unless branch_id= is explicitly passed.
 */
async function getBranchForTransactionAccess(req: AuthRequest, res: Response, txId: string): Promise<string | null> {
  const userId = req.user?.id;
  const role = req.user?.role;

  if (!userId || !role) {
    forbidden(res, 'Unauthorized');
    return null;
  }

  const requestedBranch = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';

  if (requestedBranch) {
    if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), null;
    if (role !== 'admin') return forbidden(res, 'You cannot switch branch context'), null;

    const t = await query(`SELECT branch_id FROM transactions WHERE id = $1 LIMIT 1`, [txId]);
    const bid = String(t.rows?.[0]?.branch_id || '');
    if (!bid) return notFound(res, 'Transaction not found'), null;

    if (bid !== requestedBranch) return forbidden(res, 'Transaction is not in the requested branch'), null;
    return requestedBranch;
  }

  if (role === 'admin') {
    const t = await query(`SELECT branch_id FROM transactions WHERE id = $1 LIMIT 1`, [txId]);
    const bid = t.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
    return notFound(res, 'Transaction not found'), null;
  }

  const own = await resolveUserBranchId(userId);
  if (!own) return forbidden(res, 'User is not assigned to any branch'), null;
  return own;
}

/** Ensure operator exists, active, role=operator, and belongs to the same branch. */
async function ensureOperatorInBranch(
  operatorId: string,
  branchId: string,
  db: { query: (q: string, p?: any[]) => Promise<any> }
) {
  const r = await db.query(
    `
    SELECT u.id
    FROM users u
    WHERE u.id = $1
      AND u.is_active = true
      AND u.role = 'operator'
      AND (
        u.branch_id = $2
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = u.id AND up.branch_id = $2
        )
      )
    LIMIT 1
    `,
    [operatorId, branchId]
  );
  return r.rows.length > 0;
}

// -------------------------------------------------------------------
// PRICING HELPERS (tiers fallback only)
// -------------------------------------------------------------------

function calcSubtotalFromTier(netWeight: number, tier: any | null, cp: any | null) {
  const tierPpw = Number(tier?.price_per_weighing ?? 0);
  const tierPpk = Number(tier?.price_per_kg ?? 0);
  const tierMin = Number(tier?.minimum_charge ?? 0);

  const ppw = Number(cp?.price_per_weighing ?? tierPpw);
  const ppk = Number(cp?.price_per_kg ?? tierPpk);
  const min = Number(cp?.minimum_charge ?? tierMin);
  const discount = Number(cp?.discount_percentage ?? 0);

  const weighingCharge = ppw;
  const weightCharge = netWeight * ppk;

  let subtotal = weighingCharge + weightCharge;
  if (subtotal < min) subtotal = min;

  if (discount > 0) subtotal = subtotal * (1 - discount / 100);

  subtotal = round2(subtotal);

  const breakdown =
    `Weighing: ${weighingCharge.toFixed(2)} + ` +
    `Weight (${netWeight.toFixed(2)}kg × ${ppk.toFixed(2)}): ${weightCharge.toFixed(2)}` +
    (discount > 0 ? ` - ${discount}% discount` : '') +
    (min > 0 ? ` (min ${min.toFixed(2)})` : '');

  return { subtotal, breakdown, applied: { ppw, ppk, min, discount } };
}

async function getDefaultTier(branchId: string, db: { query: (q: string, p?: any[]) => Promise<any> }) {
  const r = await db.query(
    `
    SELECT *
    FROM pricing_tiers
    WHERE branch_id = $1
      AND is_active = true
      AND effective_from <= CURRENT_DATE
    ORDER BY is_default DESC, effective_from DESC
    LIMIT 1
    `,
    [branchId]
  );
  return r.rows[0] || null;
}

async function getClientPricing(clientId: string, db: { query: (q: string, p?: any[]) => Promise<any> }) {
  const r = await db.query(
    `
    SELECT *
    FROM client_pricing
    WHERE client_id = $1
      AND effective_from <= CURRENT_DATE
      AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
    ORDER BY effective_from DESC
    LIMIT 1
    `,
    [clientId]
  );
  return r.rows[0] || null;
}

async function getVehicleType(vehicleId: string | null, db: { query: (q: string, p?: any[]) => Promise<any> }) {
  if (!vehicleId || !isUuid(vehicleId)) return null;
  const r = await db.query(`SELECT vehicle_type FROM vehicles WHERE id = $1 LIMIT 1`, [vehicleId]);
  const vt = r.rows?.[0]?.vehicle_type;
  return vt ? String(vt) : null;
}

// Billing helpers (monthly vs transaction)
type BillingMode = 'transaction' | 'monthly';

async function lockClientAccountForBilling(
  clientId: string,
  branchId: string,
  db: { query: (q: string, p?: any[]) => Promise<any> }
) {
  const r = await db.query(
    `
    SELECT
      c.id, c.branch_id, c.customer_id,
      c.credit_limit, c.current_balance, c.payment_terms,
      c.billing_mode, c.billing_cutoff_day,
      c.is_active
    FROM clients c
    WHERE c.id = $1 AND c.branch_id = $2
    FOR UPDATE
    `,
    [clientId, branchId]
  );
  return r.rows[0] || null;
}

async function lockCustomerForCredit(customerId: string, db: { query: (q: string, p?: any[]) => Promise<any> }) {
  const r = await db.query(
    `
    SELECT
      id, credit_limit, current_balance, payment_terms, primary_branch_id, is_active
    FROM customers
    WHERE id = $1
    FOR UPDATE
    `,
    [customerId]
  );
  return r.rows[0] || null;
}

async function getBranchCode(branchId: string): Promise<string> {
  try {
    const r = await query(`SELECT code FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
    const code = String(r.rows?.[0]?.code || '').trim();
    return code || 'BR';
  } catch {
    return 'BR';
  }
}

function genTxNumber(branchCode: string) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TXN-${branchCode}-${y}${m}${day}-${rand}`;
}

/**
 * Yearly sequential receipt / invoice number:
 *   2026-00001
 *   2026-00002
 *   ...
 *   2027-00001
 */
async function genInvoiceNumber(db: { query: (q: string, p?: any[]) => Promise<any> }) {
  const year = new Date().getFullYear();

  // transaction-scoped advisory lock so concurrent requests do not generate duplicates
  await db.query(`SELECT pg_advisory_xact_lock($1, $2)`, [INVOICE_NO_LOCK_NS, year]);

  const r = await db.query(
    `
    SELECT COALESCE(MAX(RIGHT(invoice_number, 5)::int), 0) AS last_seq
    FROM invoices
    WHERE invoice_number LIKE $1
      AND invoice_number ~ $2
    `,
    [`${year}-%`, `^${year}-[0-9]{5}$`]
  );

  const lastSeq = Number(r.rows?.[0]?.last_seq ?? 0);
  const nextSeq = lastSeq + 1;

  return `${year}-${String(nextSeq).padStart(5, '0')}`;
}

function genPaymentNumber(branchCode: string) {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `PAY-${branchCode}-${yy}${mm}-${rand}`;
}

/**
 * GET /api/transactions
 */
router.get('/', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilterForList(req, res);
  if (branchFilter === undefined) return;

  const limitRaw = parseIntStrict(req.query.limit);
  const offsetRaw = parseIntStrict(req.query.offset);
  const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 500) : 50;
  const offset = offsetRaw !== null ? Math.max(offsetRaw, 0) : 0;

  const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  let statusList: string[] | null = null;

  if (statusRaw && statusRaw !== 'all') {
    if (statusRaw === 'open') statusList = ['pending', 'in_progress'];
    else {
      if (!ALLOWED_STATUS_FILTERS.has(statusRaw)) return badRequest(res, 'Invalid status filter');
      statusList = [statusRaw];
    }
  }

  const from = parseISODate(req.query.from);
  const to = parseISODate(req.query.to);

  const qRaw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const q = qRaw ? `%${escapeLike(qRaw)}%` : null;

  // server-side client filter
  const clientIdRaw = typeof req.query.client_id === 'string' ? req.query.client_id.trim() : '';
  const client_id = clientIdRaw ? clientIdRaw : null;
  if (client_id && !isUuid(client_id)) return badRequest(res, 'client_id must be a UUID');

  try {
    const params: any[] = [branchFilter];
    let where = `($1::uuid IS NULL OR t.branch_id = $1)`;
    let i = 2;

    if (statusList) {
      params.push(statusList);
      where += ` AND t.status = ANY($${i}::text[])`;
      i++;
    }

    if (from) {
      params.push(from);
      where += ` AND t.created_at >= $${i}::date`;
      i++;
    }

    if (to) {
      params.push(to);
      where += ` AND t.created_at < ($${i}::date + INTERVAL '1 day')`;
      i++;
    }

    if (client_id) {
      params.push(client_id);
      where += ` AND t.client_id = $${i}::uuid`;
      i++;
    }

    if (q) {
      params.push(q);
      where += ` AND (
        t.transaction_number ILIKE $${i} ESCAPE '\\'
        OR COALESCE(c.company_name,'') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(v.license_plate,'') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(t.truck_side_number,'') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(t.walk_in_name,'') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(t.reference_number,'') ILIKE $${i} ESCAPE '\\'
        OR (t.assigned_truck_id IS NOT NULL AND t.assigned_truck_id::text ILIKE $${i} ESCAPE '\\')
      )`;
      i++;
    }

    params.push(limit);
    const limitIdx = i;
    i++;

    params.push(offset);
    const offsetIdx = i;

    const sql = `
      SELECT
        t.id,
        t.branch_id,
        t.customer_id,

        t.transaction_number,
        t.status,
        t.transaction_type,

        t.client_id,
        t.vehicle_id,
        t.operator_id,

        t.assigned_truck_id,
        t.truck_side_number,
        t.walk_in_name,

        t.first_weight,
        t.first_weight_time,
        t.second_weight,
        t.second_weight_time,

        t.net_weight,
        t.material_type,
        t.reference_number,
        t.notes,
        t.created_at,

        c.company_name,
        v.license_plate,
        v.vehicle_type
      FROM transactions t
      LEFT JOIN clients c ON c.id = t.client_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE ${where}
      ORDER BY t.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const r = await query(sql, params);

    const metaParams = params.slice(0, params.length - 2);
    const metaSql = `
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END)::int AS completed,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.net_weight ELSE 0 END), 0)::numeric AS total_net_weight
      FROM transactions t
      LEFT JOIN clients c ON c.id = t.client_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE ${where}
    `;
    const m = await query(metaSql, metaParams);

    return res.json({
      success: true,
      data: r.rows,
      meta: m.rows?.[0] || { total: 0, completed: 0, total_net_weight: 0 },
    });
  } catch (error: any) {
    console.error('List transactions error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * GET /api/transactions/:id
 */
router.get('/:id', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilterForList(req, res);
  if (branchFilter === undefined) return;

  const id = String(req.params.id || '').trim();
  if (!id || !isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const params: any[] = [id, branchFilter];

    const sql = `
      SELECT
        t.id,
        t.branch_id,
        t.customer_id,

        t.transaction_number,
        t.status,
        t.transaction_type,

        t.client_id,
        t.vehicle_id,
        t.operator_id,

        t.assigned_truck_id,
        t.truck_side_number,
        t.walk_in_name,

        t.first_weight,
        t.first_weight_time,
        t.second_weight,
        t.second_weight_time,

        t.net_weight,
        t.material_type,
        t.reference_number,
        t.notes,
        t.created_at,
        t.updated_at,

        c.company_name,
        v.license_plate,
        v.vehicle_type
      FROM transactions t
      LEFT JOIN clients c ON c.id = t.client_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.id = $1
        AND ($2::uuid IS NULL OR t.branch_id = $2)
      LIMIT 1
    `;

    const r = await query(sql, params);
    if (r.rows.length === 0) return notFound(res, 'Transaction not found');

    return res.json({ success: true, data: r.rows[0] });
  } catch (error: any) {
    console.error('Get transaction error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

// -------------------- FIRST WEIGHT HANDLER (shared) --------------------
async function handleCreateFirstWeight(req: AuthRequest, res: Response) {
  const branchId = await getScopedBranchIdForWrite(req, res);
  if (!branchId) return;

  const role = req.user!.role;
  const body = (req.body ?? {}) as any;

  const rawClientId = normalizeText(body.client_id ?? body.clientId, 80);
  const rawVehicleId = normalizeText(body.vehicle_id ?? body.vehicleId, 80);
  const bodyOperatorId = normalizeText(body.operator_id ?? body.operatorId, 80);

  const client_id = rawClientId || null;
  const vehicle_id = rawVehicleId || null;

  const operator_id = role === 'operator' ? req.user!.id : bodyOperatorId;
  if (role !== 'operator' && !operator_id) return badRequest(res, 'operator_id is required for admin/manager');

  const transaction_type_raw = normalizeText(body.transaction_type ?? body.transactionType, 30).toLowerCase();
  const transaction_type = transaction_type_raw || 'inbound';

  const firstWeight = parseNumberStrict(body.first_weight ?? body.firstWeight ?? body.gross_weight ?? body.grossWeight);

  const client_request_id = normalizeText(body.client_request_id ?? body.clientRequestId, 120) || null;

  const assigned_truck_id = parseIntStrict(body.assigned_truck_id ?? body.assignedTruckId);
  const truck_side_number = normalizeText(body.truck_side_number ?? body.truckSideNumber, 60);
  const walk_in_name = normalizeText(body.walk_in_name ?? body.walkInName, 120);

  if (!operator_id) return badRequest(res, 'operator_id is required');
  if (!isUuid(operator_id)) return badRequest(res, 'operator_id must be a UUID');

  if (assigned_truck_id === null) return badRequest(res, 'assigned_truck_id is required and must be an integer');
  if (assigned_truck_id < 0) return badRequest(res, 'assigned_truck_id must be >= 0');
  if (assigned_truck_id > 9999) return badRequest(res, 'assigned_truck_id is too large');

  if (client_id && !isUuid(client_id)) return badRequest(res, 'client_id must be a UUID');
  if (vehicle_id && !isUuid(vehicle_id)) return badRequest(res, 'vehicle_id must be a UUID');

  if (!client_id && vehicle_id) return badRequest(res, 'vehicle_id requires client_id');

  if (!ALLOWED_TRANSACTION_TYPES.has(transaction_type)) {
    return badRequest(res, 'transaction_type must be inbound or outbound');
  }

  if (firstWeight === null) return badRequest(res, 'first_weight must be a number');
  if (firstWeight < 0) return badRequest(res, 'first_weight must be >= 0');

  const material_type = normalizeText(body.material_type ?? body.materialType, 80);
  const reference_number = normalizeText(body.reference_number ?? body.referenceNumber, 80);
  const notes = normalizeText(body.notes, 2000);

  const fwsProvided = body.first_weight_stability_ms ?? body.firstWeightStabilityMs;
  const ftolProvided = body.first_weight_tolerance_kg ?? body.firstWeightToleranceKg;

  const first_weight_stable = parseBool(body.first_weight_stable ?? body.firstWeightStable);

  const first_weight_stability_ms =
    fwsProvided === undefined || fwsProvided === null || fwsProvided === '' ? null : parseIntStrict(fwsProvided);
  if (fwsProvided !== undefined && fwsProvided !== null && fwsProvided !== '' && first_weight_stability_ms === null) {
    return badRequest(res, 'first_weight_stability_ms must be an integer');
  }

  const first_weight_tolerance_kg =
    ftolProvided === undefined || ftolProvided === null || ftolProvided === '' ? null : parseNumberStrict(ftolProvided);
  if (ftolProvided !== undefined && ftolProvided !== null && ftolProvided !== '' && first_weight_tolerance_kg === null) {
    return badRequest(res, 'first_weight_tolerance_kg must be a number');
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    if (client_request_id) {
      const ex = await db.query(
        `SELECT * FROM transactions WHERE branch_id = $1 AND client_request_id = $2 LIMIT 1`,
        [branchId, client_request_id]
      );
      if (ex.rows.length > 0) {
        await db.query('COMMIT');
        return res.json({ success: true, data: ex.rows[0], meta: { existing: true } });
      }
    }

    {
      const open = await db.query(
        `
        SELECT id, transaction_number, status
        FROM transactions
        WHERE branch_id = $1
          AND assigned_truck_id = $2
          AND status IN ('pending','in_progress')
        LIMIT 1
        `,
        [branchId, assigned_truck_id]
      );
      if (open.rows.length > 0) {
        await db.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          error: `Assigned Truck ID ${assigned_truck_id} is already in use by an open transaction (${open.rows[0].transaction_number}).`,
        });
      }
    }

    if (role !== 'operator') {
      const ok = await ensureOperatorInBranch(operator_id, branchId, db);
      if (!ok) {
        await db.query('ROLLBACK');
        return badRequest(res, 'operator_id must be an active operator assigned to this branch');
      }
    }

    if (client_id) {
      const c = await db.query(`SELECT id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [client_id, branchId]);
      if (c.rows.length === 0) {
        await db.query('ROLLBACK');
        return notFound(res, 'Client not found for this branch');
      }
    }

    if (vehicle_id) {
      const v = await db.query(
        `
        SELECT v.id, v.client_id
        FROM vehicles v
        JOIN clients c ON c.id = v.client_id
        WHERE v.id = $1 AND c.branch_id = $2
        LIMIT 1
        `,
        [vehicle_id, branchId]
      );
      if (v.rows.length === 0) {
        await db.query('ROLLBACK');
        return notFound(res, 'Vehicle not found for this branch');
      }
      if (client_id && String(v.rows[0].client_id) !== String(client_id)) {
        await db.query('ROLLBACK');
        return badRequest(res, 'vehicle_id does not belong to the selected client');
      }
    }

    const branchCode = await getBranchCode(branchId);

    let txNumber = genTxNumber(branchCode);
    for (let i = 0; i < 3; i++) {
      try {
        const ins = await db.query(
          `
          INSERT INTO transactions
            (branch_id, transaction_number, client_id, vehicle_id, operator_id,
             transaction_type, status, first_weight, first_weight_time,
             assigned_truck_id, truck_side_number, walk_in_name,
             material_type, reference_number, notes,
             first_weight_stable, first_weight_stability_ms, first_weight_tolerance_kg,
             client_request_id)
          VALUES
            ($1,$2,$3,$4,$5,
             $6,'pending',$7,NOW(),
             $8,$9,$10,
             $11,$12,$13,
             $14,$15,$16,
             $17)
          RETURNING *
          `,
          [
            branchId,
            txNumber,
            client_id,
            vehicle_id,
            operator_id,
            transaction_type,
            firstWeight,

            assigned_truck_id,
            truck_side_number || null,
            client_id ? null : (walk_in_name || null),

            material_type,
            reference_number,
            notes,

            first_weight_stable,
            first_weight_stability_ms,
            first_weight_tolerance_kg,

            client_request_id,
          ]
        );

        await db.query('COMMIT');
        return res.status(201).json({ success: true, data: ins.rows[0] });
      } catch (e: any) {
        if (e?.code === '23505') {
          if (client_request_id) {
            const ex = await db.query(
              `SELECT * FROM transactions WHERE branch_id = $1 AND client_request_id = $2 LIMIT 1`,
              [branchId, client_request_id]
            );
            if (ex.rows.length > 0) {
              await db.query('COMMIT');
              return res.json({ success: true, data: ex.rows[0], meta: { existing: true } });
            }
          }
          txNumber = genTxNumber(branchCode);
          continue;
        }
        throw e;
      }
    }

    await db.query('ROLLBACK');
    return res.status(409).json({ success: false, error: 'Could not generate unique transaction number' });
  } catch (error: any) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('Create transaction error', { code: error?.code, message: error?.message });
    return serverError(res);
  } finally {
    db.release();
  }
}

/**
 * POST /api/transactions  (FIRST weight)
 */
router.post('/', requireRole(['operator', 'admin', 'manager']), handleCreateFirstWeight);
router.post('/first-weight', requireRole(['operator', 'admin', 'manager']), handleCreateFirstWeight);

// -------------------- COMPLETE HANDLER (shared) --------------------
async function handleCompleteTransaction(req: AuthRequest, res: Response) {
  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  const branchId = await getBranchForTransactionAccess(req, res, id);
  if (!branchId) return;

  const body = (req.body ?? {}) as any;

  const secondWeight = parseNumberStrict(body.second_weight ?? body.secondWeight);
  if (secondWeight === null) return badRequest(res, 'second_weight must be a number');
  if (secondWeight < 0) return badRequest(res, 'second_weight must be >= 0');

  const swsProvided = body.second_weight_stability_ms ?? body.secondWeightStabilityMs;
  const stolProvided = body.second_weight_tolerance_kg ?? body.secondWeightToleranceKg;

  const second_weight_stable = parseBool(body.second_weight_stable ?? body.secondWeightStable);

  const second_weight_stability_ms =
    swsProvided === undefined || swsProvided === null || swsProvided === '' ? null : parseIntStrict(swsProvided);
  if (swsProvided !== undefined && swsProvided !== null && swsProvided !== '' && second_weight_stability_ms === null) {
    return badRequest(res, 'second_weight_stability_ms must be an integer');
  }

  const second_weight_tolerance_kg =
    stolProvided === undefined || stolProvided === null || stolProvided === '' ? null : parseNumberStrict(stolProvided);
  if (stolProvided !== undefined && stolProvided !== null && stolProvided !== '' && second_weight_tolerance_kg === null) {
    return badRequest(res, 'second_weight_tolerance_kg must be a number');
  }

  const item_count_raw = body.item_count ?? body.itemCount;
  const item_count =
    item_count_raw === undefined || item_count_raw === null || item_count_raw === '' ? null : parseIntStrict(item_count_raw);

  const actorId = req.user!.id;
  const actorRole = req.user!.role;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const tRes = await db.query(`SELECT * FROM transactions WHERE id = $1 AND branch_id = $2 FOR UPDATE`, [id, branchId]);
    if (tRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return notFound(res, 'Transaction not found');
    }

    const tx = tRes.rows[0];
    const status = String(tx.status || '').toLowerCase();

    if (actorRole === 'operator' && String(tx.operator_id) !== String(actorId)) {
      await db.query('ROLLBACK');
      return forbidden(res, 'You can only complete your own transactions');
    }

    if (status === 'cancelled') {
      await db.query('ROLLBACK');
      return badRequest(res, 'Transaction is cancelled');
    }

    if (status === 'completed') {
      const invRes = await db.query(`SELECT * FROM invoices WHERE transaction_id = $1 AND branch_id = $2 LIMIT 1`, [
        tx.id,
        branchId,
      ]);
      const chRes = await db.query(`SELECT * FROM billing_charges WHERE transaction_id = $1 LIMIT 1`, [tx.id]);

      await db.query('COMMIT');
      return res.json({
        success: true,
        data: { transaction: tx, invoice: invRes.rows[0] || null, billing_charge: chRes.rows[0] || null },
      });
    }

    if (status !== 'pending' && status !== 'in_progress') {
      await db.query('ROLLBACK');
      return badRequest(res, 'Transaction is not pending');
    }

    const firstWeight = Number(tx.first_weight ?? 0);
    if (!Number.isFinite(firstWeight)) {
      await db.query('ROLLBACK');
      return badRequest(res, 'Transaction first_weight is invalid');
    }

    const netWeight = Math.abs(firstWeight - secondWeight);

    const txClientId = tx.client_id ? String(tx.client_id) : null;
    const materialType = String(tx.material_type || '');
    const vehicleType = await getVehicleType(tx.vehicle_id ? String(tx.vehicle_id) : null, db);

    const pricingResolved = await resolvePricing({
      branch_id: branchId,
      net_weight_kg: netWeight,
      client_id: txClientId,
      material_type: materialType || null,
      vehicle_type: vehicleType || null,
      item_count,
      at: new Date(),
    });

    let pricing_engine: 'rules' | 'tiers' = 'tiers';

    let subtotal = 0;
    let breakdown = '';
    let applied: any = {};

    let tierId: string | null = null;
    let clientPricingId: string | null = null;

    let pricingRuleId: string | null = null;
    let pricingRuleName: string | null = null;
    let pricingUnitType: string | null = null;
    let pricingQuantity: number | null = null;
    let pricingUnitPrice: number | null = null;

    if (pricingResolved) {
      pricing_engine = 'rules';

      subtotal = round2(pricingResolved.amount);
      breakdown = pricingResolved.description;

      pricingRuleId = pricingResolved.rule_id;
      pricingUnitType = pricingResolved.unit_type;
      pricingQuantity = pricingResolved.quantity;
      pricingUnitPrice = pricingResolved.unit_price;

      applied = {
        pricing_rule_id: pricingRuleId,
        unit_type: pricingUnitType,
        quantity: pricingQuantity,
        unit_price: pricingUnitPrice,
      };

      const rr = await db.query(`SELECT name FROM pricing_rules WHERE id = $1 LIMIT 1`, [pricingRuleId]);
      pricingRuleName = rr.rows?.[0]?.name ? String(rr.rows[0].name) : null;
    } else {
      const defaultTier = await getDefaultTier(branchId, db);
      if (!defaultTier) {
        await db.query('ROLLBACK');
        return badRequest(
          res,
          'No pricing rule matched (or item_count required), and no active pricing tier configured for this branch'
        );
      }

      const clientPricing = txClientId ? await getClientPricing(txClientId, db) : null;
      const out = calcSubtotalFromTier(netWeight, defaultTier, clientPricing);

      subtotal = out.subtotal;
      breakdown = out.breakdown;
      applied = out.applied;

      tierId = defaultTier?.id ?? null;
      clientPricingId = clientPricing?.id ?? null;
    }

    const tax_rate = GST_RATE;
    const tax_amount = round2((subtotal * tax_rate) / 100);
    const total_amount = round2(subtotal + tax_amount);

    const isWalkIn = !tx.client_id;

    let clientRow: any = null;
    let customerRow: any = null;

    let billing_mode: BillingMode = 'transaction';
    let customer_id: string | null = null;

    if (!isWalkIn && tx.client_id) {
      clientRow = await lockClientAccountForBilling(String(tx.client_id), branchId, db);
      if (!clientRow) {
        await db.query('ROLLBACK');
        return notFound(res, 'Client not found for this branch');
      }
      if (clientRow.is_active === false) {
        await db.query('ROLLBACK');
        return badRequest(res, 'Client is inactive');
      }

      customer_id = clientRow.customer_id ? String(clientRow.customer_id) : null;
      billing_mode = String(clientRow.billing_mode || 'transaction').toLowerCase() === 'monthly' ? 'monthly' : 'transaction';

      if (!customer_id || !isUuid(customer_id)) {
        await db.query('ROLLBACK');
        return badRequest(res, 'Client is missing customer_id (apply cross-branch customer migration/backfill)');
      }

      customerRow = await lockCustomerForCredit(customer_id, db);
      if (!customerRow) {
        await db.query('ROLLBACK');
        return notFound(res, 'Customer not found for this client');
      }
      if (customerRow.is_active === false) {
        await db.query('ROLLBACK');
        return badRequest(res, 'Customer is inactive');
      }

      const creditLimit = Number(customerRow.credit_limit ?? 0);
      const currentBalance = Number(customerRow.current_balance ?? 0);
      const EPS = 0.01;

      if (creditLimit > 0 && currentBalance + total_amount > creditLimit + EPS) {
        await db.query('ROLLBACK');
        return badRequest(
          res,
          `Credit limit exceeded (customer-level). Current balance=${currentBalance.toFixed(
            2
          )}, new charge=${total_amount.toFixed(2)}, limit=${creditLimit.toFixed(2)}`
        );
      }
    }

    const upd = await db.query(
      `
      UPDATE transactions
      SET
        second_weight = $1,
        net_weight = $2,
        second_weight_time = NOW(),
        status = 'completed',
        second_weight_stable = $3,
        second_weight_stability_ms = $4,
        second_weight_tolerance_kg = $5,
        customer_id = $6,
        updated_at = NOW()
      WHERE id = $7 AND branch_id = $8
      RETURNING *
      `,
      [
        secondWeight,
        netWeight,
        second_weight_stable,
        second_weight_stability_ms,
        second_weight_tolerance_kg,
        customer_id,
        tx.id,
        branchId,
      ]
    );

    const paymentTerms = isWalkIn ? 'Cash' : String(clientRow?.payment_terms || customerRow?.payment_terms || 'Net 30');

    if (!isWalkIn && billing_mode === 'monthly' && customer_id) {
      let billingChargeRow: any = null;

      try {
        const ch = await db.query(
          `
          INSERT INTO billing_charges
            (customer_id, client_id, branch_id, transaction_id, service_date,
             subtotal, tax_rate, tax_amount, total_amount,
             pricing_engine, pricing_rule_id, pricing_rule_name,
             pricing_unit_type, pricing_quantity, pricing_unit_price,
             status)
          VALUES
            ($1,$2,$3,$4,CURRENT_DATE,
             $5,$6,$7,$8,
             $9,$10,$11,
             $12,$13,$14,
             'unbilled')
          RETURNING *
          `,
          [
            customer_id,
            tx.client_id,
            branchId,
            tx.id,
            subtotal,
            tax_rate,
            tax_amount,
            total_amount,
            pricing_engine,
            pricingRuleId,
            pricingRuleName,
            pricingUnitType,
            pricingQuantity,
            pricingUnitPrice,
          ]
        );
        billingChargeRow = ch.rows[0];
      } catch (e: any) {
        if (e?.code === '23505') {
          const ex = await db.query(`SELECT * FROM billing_charges WHERE transaction_id = $1 LIMIT 1`, [tx.id]);
          billingChargeRow = ex.rows[0] || null;
        } else {
          throw e;
        }
      }

      await db.query(
        `
        UPDATE customers
        SET current_balance = COALESCE(current_balance, 0) + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [total_amount, customer_id]
      );

      await db.query(
        `
        UPDATE clients
        SET current_balance = COALESCE(current_balance, 0) + $1,
            updated_at = NOW()
        WHERE id = $2 AND branch_id = $3
        `,
        [total_amount, tx.client_id, branchId]
      );

      await db.query('COMMIT');

      return res.json({
        success: true,
        data: {
          transaction: upd.rows[0],
          invoice: null,
          payment: null,
          billing_charge: billingChargeRow,
          pricing: {
            engine: pricing_engine,
            subtotal,
            tax_rate,
            tax_amount,
            total: total_amount,
            breakdown,
            applied,
            pricingRuleId,
            pricingRuleName,
            pricingUnitType,
            pricingQuantity,
            pricingUnitPrice,
            defaultTierId: tierId,
            clientPricingId,
            billing_mode,
            customer_id,
          },
        },
      });
    }

    const due = new Date();
    if (!isWalkIn) due.setDate(due.getDate() + 30);
    const dueDateStr = due.toISOString().slice(0, 10);

    const branchCode = await getBranchCode(branchId);

    const invoiceStatus = isWalkIn ? 'paid' : 'sent';
    const paid_amount = isWalkIn ? total_amount : 0;
    const balance = isWalkIn ? 0 : total_amount;

    let invoiceNumber = await genInvoiceNumber(db);
    let invoiceRow: any = null;

    for (let i2 = 0; i2 < 3; i2++) {
      try {
        const invIns = await db.query(
          `
          INSERT INTO invoices
            (branch_id, client_id, customer_id,
             invoice_type,
             transaction_id, invoice_number, invoice_date, due_date,
             subtotal, tax_rate, tax_amount, total_amount, paid_amount, balance,
             status, payment_terms, notes,

             pricing_tier_id, client_pricing_id,
             price_per_weighing, price_per_kg, minimum_charge, discount_percentage,
             pricing_breakdown, pricing_calculated_at,

             pricing_engine, pricing_rule_id, pricing_rule_name,
             pricing_unit_type, pricing_quantity, pricing_unit_price)
          VALUES
            ($1,$2,$3,
             'transaction',
             $4,$5,CURRENT_DATE,$6,
             $7,$8,$9,$10,$11,$12,
             $13,$14,$15,

             $16,$17,
             $18,$19,$20,$21,
             $22,NOW(),

             $23,$24,$25,
             $26,$27,$28)
          RETURNING *
          `,
          [
            branchId,
            isWalkIn ? null : tx.client_id,
            isWalkIn ? null : customer_id,

            tx.id,
            invoiceNumber,
            dueDateStr,

            subtotal,
            tax_rate,
            tax_amount,
            total_amount,
            paid_amount,
            balance,

            invoiceStatus,
            paymentTerms,
            `Auto from ${tx.transaction_number}`,

            tierId,
            clientPricingId,
            pricing_engine === 'tiers' ? applied.ppw ?? null : null,
            pricing_engine === 'tiers' ? applied.ppk ?? null : null,
            pricing_engine === 'tiers' ? applied.min ?? null : null,
            pricing_engine === 'tiers' ? applied.discount ?? 0 : 0,

            breakdown,

            pricing_engine,
            pricingRuleId,
            pricingRuleName,
            pricingUnitType,
            pricingQuantity,
            pricingUnitPrice,
          ]
        );

        invoiceRow = invIns.rows[0];
        break;
      } catch (e: any) {
        if (e?.code === '23505') {
          invoiceNumber = await genInvoiceNumber(db);
          continue;
        }
        throw e;
      }
    }

    if (!invoiceRow) {
      await db.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'Could not generate unique invoice number' });
    }

    if (!isWalkIn && tx.client_id && customer_id) {
      await db.query(
        `
        UPDATE customers
        SET current_balance = COALESCE(current_balance, 0) + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [total_amount, customer_id]
      );

      await db.query(
        `
        UPDATE clients
        SET current_balance = COALESCE(current_balance, 0) + $1,
            updated_at = NOW()
        WHERE id = $2 AND branch_id = $3
        `,
        [total_amount, tx.client_id, branchId]
      );
    }

    const isItemPricing = pricing_engine === 'rules' && String(pricingUnitType || '').toLowerCase() === 'item';

    const itemPart =
      isItemPricing && typeof pricingQuantity === 'number' && Number.isFinite(pricingQuantity) && pricingQuantity > 0
        ? `, items: ${Math.round(pricingQuantity)}`
        : '';

    const desc = `Weighing ${tx.transaction_number} — first: ${firstWeight.toFixed(
      2
    )}kg, second: ${secondWeight.toFixed(2)}kg, net: ${netWeight.toFixed(2)}kg${itemPart}`;

    await db.query(
      `
      INSERT INTO invoice_line_items
        (invoice_id, transaction_id, description, quantity, unit_price, amount)
      VALUES
        ($1,$2,$3,1,$4,$5)
      `,
      [invoiceRow.id, tx.id, desc, subtotal, subtotal]
    );

    let paymentRow: any = null;
    if (isWalkIn && total_amount > 0) {
      let payNo = genPaymentNumber(branchCode);
      for (let i3 = 0; i3 < 3; i3++) {
        try {
          const p = await db.query(
            `
            INSERT INTO payments
              (branch_id, invoice_id, payment_number, payment_date, paid_at, amount,
               payment_method, reference_number, notes, created_by)
            VALUES
              ($1,$2,$3,CURRENT_DATE,NOW(),$4,
               'cash','', $5, $6)
            RETURNING *
            `,
            [branchId, invoiceRow.id, payNo, total_amount, `Auto cash payment for walk-in ${tx.transaction_number}`, actorId]
          );
          paymentRow = p.rows[0];
          break;
        } catch (e: any) {
          if (e?.code === '23505') {
            payNo = genPaymentNumber(branchCode);
            continue;
          }
          throw e;
        }
      }
    }

    await db.query('COMMIT');

    return res.json({
      success: true,
      data: {
        transaction: upd.rows[0],
        invoice: invoiceRow,
        payment: paymentRow,
        billing_charge: null,
        pricing: {
          engine: pricing_engine,
          subtotal,
          tax_rate,
          tax_amount,
          total: total_amount,
          breakdown,
          applied,
          pricingRuleId,
          pricingRuleName,
          pricingUnitType,
          pricingQuantity,
          pricingUnitPrice,
          defaultTierId: tierId,
          clientPricingId,
          billing_mode,
          customer_id,
        },
      },
    });
  } catch (error: any) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('Complete transaction error', { code: error?.code, message: error?.message });
    return serverError(res);
  } finally {
    db.release();
  }
}

/**
 * PATCH /api/transactions/:id/complete (SECOND weight)
 */
router.patch('/:id/complete', requireRole(['operator', 'admin', 'manager']), handleCompleteTransaction);
router.post('/:id/complete', requireRole(['operator', 'admin', 'manager']), handleCompleteTransaction);

export default router;