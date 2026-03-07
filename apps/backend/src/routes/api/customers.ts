// apps/backend/src/routes/api/customers.ts
import { Router, Response } from 'express';
import { pool, query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

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

function parseNumberStrict(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function looksLikeEmail(v: string) {
  const s = v.trim();
  if (!s) return true; // allow empty
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

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
 * Branch filter for reads:
 * - admin: null (all branches) by default; optional ?branch_id=
 * - manager/operator: forced to own branch
 */
async function getBranchFilterForRead(req: AuthRequest, res: Response): Promise<string | null | undefined> {
  const userId = req.user?.id;
  const role = req.user?.role;

  if (!userId || !role) {
    forbidden(res, 'Unauthorized');
    return undefined;
  }

  const requestedBranch = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';

  if (role === 'admin') {
    if (requestedBranch) {
      if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), undefined;
      return requestedBranch;
    }
    return null;
  }

  const own = await resolveUserBranchId(userId);
  if (!own) return forbidden(res, 'User is not assigned to any branch'), undefined;

  if (requestedBranch) {
    if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), undefined;
    if (requestedBranch !== own) return forbidden(res, 'You cannot switch branch context'), undefined;
  }

  return own;
}

/**
 * Branch id for write:
 * - admin: may provide branch_id in body/query; else uses own assignment; if none => error
 * - manager: forced to own branch
 */
async function getBranchIdForWrite(req: AuthRequest, res: Response, branchIdInput?: unknown): Promise<string | null> {
  const userId = req.user?.id;
  const role = req.user?.role;
  if (!userId || !role) return forbidden(res, 'Unauthorized'), null;

  const bodyBid = typeof branchIdInput === 'string' ? branchIdInput.trim() : '';
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

  if (role === 'manager') {
    if (!own) return forbidden(res, 'User is not assigned to any branch'), null;
    if (requested) {
      if (!isUuid(requested)) return badRequest(res, 'Invalid branch_id'), null;
      if (requested !== own) return forbidden(res, 'You cannot switch branch context'), null;
    }
    return own;
  }

  return forbidden(res, 'Forbidden'), null;
}

// ---------------------------------------------------------------------
// GET /api/customers  (global customers visible to user)
// - admin: can view all customers; optional branch filter
// - manager/operator: only customers attached to own branch (via clients)
// ---------------------------------------------------------------------
router.get('/', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilterForRead(req, res);
  if (branchFilter === undefined) return;

  const limitRaw = parseIntStrict(req.query.limit);
  const offsetRaw = parseIntStrict(req.query.offset);
  const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 200) : 100;
  const offset = offsetRaw !== null ? Math.max(offsetRaw, 0) : 0;

  const q = typeof req.query.q === 'string' ? normalizeText(req.query.q, 120) : '';
  const hasQ = q.length > 0;
  const like = hasQ ? `%${q}%` : null;

  const activeParam = String(req.query.active ?? 'true').toLowerCase();
  const active = activeParam === 'all' ? null : activeParam === 'false' ? false : true;


  try {
    // If branchFilter != null: restrict to customers attached to that branch via clients.
    const params: any[] = [branchFilter, active];
    let where = `
      WHERE ($2::boolean IS NULL OR c.is_active = $2)
        AND ($1::uuid IS NULL OR EXISTS (
          SELECT 1 FROM clients cl
          WHERE cl.customer_id = c.id AND cl.branch_id = $1
        ))
    `;

    if (hasQ) {
      params.push(like);
      where += `
        AND (
          c.company_name ILIKE $3
          OR COALESCE(c.contact_person,'') ILIKE $3
          OR COALESCE(c.phone,'') ILIKE $3
          OR COALESCE(c.email::text,'') ILIKE $3
          OR COALESCE(c.tax_id,'') ILIKE $3
        )
      `;
    }

    params.push(limit, offset);

    const sql = `
      SELECT
        c.id,
        c.company_name,
        c.contact_person,
        c.phone,
        c.email,
        c.address,
        c.tax_id,
        c.payment_terms,
        c.credit_limit,
        c.current_balance,
        c.primary_branch_id,
        c.is_active,
        c.created_at,
        c.updated_at,
        (
          SELECT COUNT(*)::int
          FROM clients cl
          WHERE cl.customer_id = c.id
        ) AS branches_count
      FROM customers c
      ${where}
      ORDER BY c.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const r = await query(sql, params);
    return res.json({ success: true, data: r.rows });
  } catch (e: any) {
    console.error('List customers error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

// ---------------------------------------------------------------------
// GET /api/customers/:id (detail + attached branch accounts)
// ---------------------------------------------------------------------
router.get('/:id', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilterForRead(req, res);
  if (branchFilter === undefined) return;

  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    // enforce visibility for non-admin via branchFilter
    const cust = await query(
      `
      SELECT *
      FROM customers c
      WHERE c.id = $1
        AND ($2::uuid IS NULL OR EXISTS (
          SELECT 1 FROM clients cl
          WHERE cl.customer_id = c.id AND cl.branch_id = $2
        ))
      LIMIT 1
      `,
      [id, branchFilter]
    );

    if (cust.rows.length === 0) return notFound(res, 'Customer not found');

    const accounts = await query(
      `
      SELECT
        cl.id,
        cl.branch_id,
        b.name AS branch_name,
        b.code AS branch_code,
        cl.company_name,
        cl.contact_person,
        cl.phone,
        cl.email,
        cl.address,
        cl.tax_id,
        cl.payment_terms,
        cl.credit_limit,
        cl.current_balance,
        cl.is_active,
        cl.is_primary,
        cl.billing_mode,
        cl.billing_cutoff_day,
        cl.created_at,
        cl.updated_at
      FROM clients cl
      LEFT JOIN branches b ON b.id = cl.branch_id
      WHERE cl.customer_id = $1
        AND ($2::uuid IS NULL OR cl.branch_id = $2)
      ORDER BY cl.is_primary DESC, cl.created_at DESC
      `,
      [id, branchFilter]
    );

    return res.json({
      success: true,
      data: {
        customer: cust.rows[0],
        accounts: accounts.rows,
      },
    });
  } catch (e: any) {
    console.error('Get customer detail error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

// ---------------------------------------------------------------------
// POST /api/customers (create global customer)
// - admin/manager only
// - manager: primary_branch_id forced to own branch
// ---------------------------------------------------------------------
router.post('/', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const role = req.user?.role || '';

  const b: any = req.body || {};
  const company_name = normalizeText(b.company_name ?? b.companyName, 200);
  if (company_name.length < 2) return badRequest(res, 'company_name is required (min 2 chars)');

  const contact_person = normalizeText(b.contact_person ?? b.contactPerson, 150);
  if (contact_person.length < 2) return badRequest(res, 'contact_person is required (min 2 chars)');

  const phone = normalizeText(b.phone, 60);
  if (phone.length < 3) return badRequest(res, 'phone is required');

  const email = normalizeText(b.email, 120);
  if (!looksLikeEmail(email)) return badRequest(res, 'Invalid email format');

  const address = normalizeText(b.address, 250);
  const tax_id = normalizeText(b.tax_id ?? b.taxId, 80);

  const payment_terms = normalizeText(b.payment_terms ?? b.paymentTerms, 80) || 'Net 30';

  const credit_limit = parseNumberStrict(b.credit_limit ?? b.creditLimit) ?? 0;
  if (credit_limit < 0) return badRequest(res, 'credit_limit must be >= 0');

  const is_active_raw = b.is_active;
  const is_active = is_active_raw === undefined ? true : (typeof is_active_raw === 'boolean' ? is_active_raw : null);
  if (is_active === null) return badRequest(res, 'is_active must be a boolean');

  // primary branch handling
  let primary_branch_id: string | null = null;

  if (role === 'admin') {
    const requested = normalizeText(b.primary_branch_id ?? b.primaryBranchId, 80);
    if (requested) {
      if (!isUuid(requested)) return badRequest(res, 'primary_branch_id must be a UUID');
      primary_branch_id = requested;
    } else {
      const own = await resolveUserBranchId(req.user!.id);
      primary_branch_id = own || null;
    }
  } else {
    // manager: forced to own branch
    const own = await resolveUserBranchId(req.user!.id);
    if (!own) return forbidden(res, 'User is not assigned to any branch');
    primary_branch_id = own;
  }

  try {
    if (primary_branch_id) {
      const br = await query(`SELECT id FROM branches WHERE id = $1 LIMIT 1`, [primary_branch_id]);
      if (br.rows.length === 0) return badRequest(res, 'primary_branch_id not found');
    }

    const r = await query(
      `
      INSERT INTO customers
        (company_name, contact_person, phone, email, address, tax_id,
         payment_terms, credit_limit, current_balance, primary_branch_id, is_active)
      VALUES
        ($1,$2,$3, NULLIF($4,''), $5,$6,
         $7,$8,0,$9,$10)
      RETURNING *
      `,
      [
        company_name,
        contact_person,
        phone,
        email,
        address,
        tax_id,
        payment_terms,
        credit_limit,
        primary_branch_id,
        is_active,
      ]
    );

    return res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e: any) {
    console.error('Create customer error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

// ---------------------------------------------------------------------
// POST /api/customers/:id/attach-branch
// Creates a branch "account" in clients referencing customer_id
// - admin/manager only
// - manager: forced to own branch
// ---------------------------------------------------------------------
router.post('/:id/attach-branch', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const customerId = String(req.params.id || '').trim();
  if (!isUuid(customerId)) return badRequest(res, 'customer id must be a UUID');

  const branchId = await getBranchIdForWrite(req, res, (req.body as any)?.branch_id ?? (req.body as any)?.branchId);
  if (!branchId) return;

  const b: any = req.body || {};

  const billing_mode_raw = normalizeText(b.billing_mode ?? b.billingMode, 30).toLowerCase();
  const billing_mode = billing_mode_raw ? billing_mode_raw : 'transaction';
  if (billing_mode !== 'transaction' && billing_mode !== 'monthly') {
    return badRequest(res, "billing_mode must be 'transaction' or 'monthly'");
  }

  const cutoffDay = parseIntStrict(b.billing_cutoff_day ?? b.billingCutoffDay) ?? 31;
  if (cutoffDay < 1 || cutoffDay > 31) return badRequest(res, 'billing_cutoff_day must be between 1 and 31');

  const is_primary_raw = b.is_primary;
  const is_primary = is_primary_raw === undefined ? false : (typeof is_primary_raw === 'boolean' ? is_primary_raw : null);
  if (is_primary === null) return badRequest(res, 'is_primary must be a boolean');

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const cust = await db.query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [customerId]);
    if (cust.rows.length === 0) {
      await db.query('ROLLBACK');
      return notFound(res, 'Customer not found');
    }
    const c = cust.rows[0];

    // branch exists?
    const br = await db.query(`SELECT id FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
    if (br.rows.length === 0) {
      await db.query('ROLLBACK');
      return badRequest(res, 'branch_id not found');
    }

    // idempotent: already attached?
    const existing = await db.query(
      `SELECT * FROM clients WHERE customer_id = $1 AND branch_id = $2 LIMIT 1`,
      [customerId, branchId]
    );
    if (existing.rows.length > 0) {
      await db.query('COMMIT');
      return res.json({ success: true, data: existing.rows[0], meta: { existing: true } });
    }

    // Allow overriding some contact details per branch account if provided, else inherit from customer
    const company_name = normalizeText(b.company_name ?? b.companyName, 200) || normalizeText(c.company_name, 200);
    const contact_person =
      normalizeText(b.contact_person ?? b.contactPerson, 150) || normalizeText(c.contact_person, 150);
    const phone = normalizeText(b.phone, 60) || normalizeText(c.phone, 60);
    const email = normalizeText(b.email, 120) || normalizeText(c.email, 120);
    const address = normalizeText(b.address, 250) || normalizeText(c.address, 250);
    const tax_id = normalizeText(b.tax_id ?? b.taxId, 80) || normalizeText(c.tax_id, 80);
    const payment_terms =
      normalizeText(b.payment_terms ?? b.paymentTerms, 80) || normalizeText(c.payment_terms, 80) || 'Net 30';

    const credit_limit = parseNumberStrict(b.credit_limit ?? b.creditLimit);
    const branchCreditLimit = credit_limit === null ? Number(c.credit_limit ?? 0) : credit_limit;
    if (branchCreditLimit < 0) {
      await db.query('ROLLBACK');
      return badRequest(res, 'credit_limit must be >= 0');
    }

    if (!company_name || company_name.length < 2) {
      await db.query('ROLLBACK');
      return badRequest(res, 'company_name is required (min 2 chars)');
    }
    if (!contact_person || contact_person.length < 2) {
      await db.query('ROLLBACK');
      return badRequest(res, 'contact_person is required (min 2 chars)');
    }
    if (!phone || phone.length < 3) {
      await db.query('ROLLBACK');
      return badRequest(res, 'phone is required');
    }
    if (!looksLikeEmail(email)) {
      await db.query('ROLLBACK');
      return badRequest(res, 'Invalid email format');
    }

    // If setting primary: clear others first
    if (is_primary) {
      await db.query(`UPDATE clients SET is_primary = false WHERE customer_id = $1`, [customerId]);
      await db.query(`UPDATE customers SET primary_branch_id = $1, updated_at = NOW() WHERE id = $2`, [
        branchId,
        customerId,
      ]);
    }

    const ins = await db.query(
      `
      INSERT INTO clients
        (branch_id, customer_id, is_primary,
         company_name, contact_person, phone, email, address, tax_id,
         credit_limit, current_balance, payment_terms, notes, is_active,
         billing_mode, billing_cutoff_day)
      VALUES
        ($1,$2,$3,
         $4,$5,$6, NULLIF($7,''), $8,$9,
         $10,0,$11,'',true,
         $12,$13)
      RETURNING *
      `,
      [
        branchId,
        customerId,
        is_primary,
        company_name,
        contact_person,
        phone,
        email,
        address,
        tax_id,
        branchCreditLimit,
        payment_terms,
        billing_mode,
        cutoffDay,
      ]
    );

    await db.query('COMMIT');
    return res.status(201).json({ success: true, data: ins.rows[0] });
  } catch (e: any) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('Attach branch error', { code: e?.code, message: e?.message });
    return serverError(res);
  } finally {
    db.release();
  }
});

// ---------------------------------------------------------------------
// POST /api/customers/:id/set-primary-branch
// - admin/manager only
// - manager: can only set to their own branch
// ---------------------------------------------------------------------
router.post('/:id/set-primary-branch', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const customerId = String(req.params.id || '').trim();
  if (!isUuid(customerId)) return badRequest(res, 'customer id must be a UUID');

  const branchId = await getBranchIdForWrite(req, res, (req.body as any)?.branch_id ?? (req.body as any)?.branchId);
  if (!branchId) return;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const cust = await db.query(`SELECT id FROM customers WHERE id = $1 LIMIT 1`, [customerId]);
    if (cust.rows.length === 0) {
      await db.query('ROLLBACK');
      return notFound(res, 'Customer not found');
    }

    const acc = await db.query(
      `SELECT id FROM clients WHERE customer_id = $1 AND branch_id = $2 LIMIT 1`,
      [customerId, branchId]
    );
    if (acc.rows.length === 0) {
      await db.query('ROLLBACK');
      return badRequest(res, 'Customer is not attached to that branch (attach-branch first)');
    }

    await db.query(`UPDATE clients SET is_primary = false WHERE customer_id = $1`, [customerId]);
    await db.query(`UPDATE clients SET is_primary = true WHERE customer_id = $1 AND branch_id = $2`, [
      customerId,
      branchId,
    ]);

    const upd = await db.query(
      `UPDATE customers SET primary_branch_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [branchId, customerId]
    );

    await db.query('COMMIT');
    return res.json({ success: true, data: upd.rows[0] });
  } catch (e: any) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('Set primary branch error', { code: e?.code, message: e?.message });
    return serverError(res);
  } finally {
    db.release();
  }
});

export default router;
