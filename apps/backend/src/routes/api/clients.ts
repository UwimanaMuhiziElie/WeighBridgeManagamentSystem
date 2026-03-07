// apps/backend/src/routes/api/clients.ts
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
function notFound(res: Response, message: string) {
  return res.status(404).json({ success: false, error: message });
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

function parseNumberStrict(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function parseIntStrict(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function escapeLike(input: string) {
  return input.replace(/[%_\\]/g, (m) => `\\${m}`);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

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
  current_balance,
  payment_terms,
  notes,
  is_active,
  created_at,
  updated_at
`;

// ---- branch helpers (consistent with transactions.ts) ----
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

// LIST/READ: admin => all (optional ?branch_id), manager/operator => own branch only
async function getBranchFilterForRead(req: AuthRequest, res: Response): Promise<string | null | undefined> {
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

// WRITE: admin may set ?branch_id; manager/operator forced to own
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
    if (role !== 'admin') return forbidden(res, 'You cannot switch branch context'), null;
    return requestedBranch;
  }

  const own = await resolveUserBranchId(userId);
  if (own) return own;

  if (role === 'admin') return badRequest(res, 'branch_id is required for admin without a branch assignment'), null;

  return forbidden(res, 'User is not assigned to any branch'), null;
}

/**
 * GET /api/clients?include_inactive=true&limit=100&offset=0&q=...
 */
router.get('/', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  try {
    const branchFilter = await getBranchFilterForRead(req, res);
    if (branchFilter === undefined) return;

    const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';

    const limitRaw = parseIntStrict(req.query.limit);
    const offsetRaw = parseIntStrict(req.query.offset);
    const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 200) : 100;
    const offset = offsetRaw !== null ? Math.max(offsetRaw, 0) : 0;

    const qRaw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const q = qRaw ? `%${escapeLike(qRaw)}%` : null;

    const params: any[] = [branchFilter, includeInactive];
    let where = `
      WHERE ($1::uuid IS NULL OR branch_id = $1)
        AND ($2::boolean OR is_active = true)
    `;
    let i = 3;

    if (q) {
      params.push(q);
      where += `
        AND (
          company_name ILIKE $${i} ESCAPE '\\'
          OR contact_person ILIKE $${i} ESCAPE '\\'
          OR phone ILIKE $${i} ESCAPE '\\'
          OR email ILIKE $${i} ESCAPE '\\'
          OR COALESCE(tax_id,'') ILIKE $${i} ESCAPE '\\'
          OR id::text ILIKE $${i} ESCAPE '\\'
        )
      `;
      i++;
    }

    params.push(limit);
    const limitIdx = i; i++;
    params.push(offset);
    const offsetIdx = i;

    const rows = await query(
      `SELECT ${CLIENT_COLUMNS}
       FROM clients
       ${where}
       ORDER BY company_name
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const metaParams = params.slice(0, params.length - 2);
    const meta = await query(
      `SELECT COUNT(*)::int AS total
       FROM clients
       ${where}`,
      metaParams
    );

    return res.json({
      success: true,
      data: rows.rows,
      meta: meta.rows?.[0] || { total: 0 },
    });
  } catch (error: any) {
    console.error('Get clients error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * GET /api/clients/:id
 */
router.get('/:id', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const branchFilter = await getBranchFilterForRead(req, res);
    if (branchFilter === undefined) return;

    const r = await query(
      `SELECT ${CLIENT_COLUMNS}
       FROM clients
       WHERE id = $1
         AND ($2::uuid IS NULL OR branch_id = $2)
       LIMIT 1`,
      [id, branchFilter]
    );

    if (r.rows.length === 0) return notFound(res, 'Client not found');
    return res.json({ success: true, data: r.rows[0] });
  } catch (error: any) {
    console.error('Get client error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * POST /api/clients
 */
router.post('/', requireRole(['operator', 'admin', 'manager']), async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role || 'operator';
    const isOperator = role === 'operator';

    const branchId = await getScopedBranchIdForWrite(req, res);
    if (!branchId) return;

    if (req.body?.branch_id !== undefined) {
      return badRequest(res, 'branch_id must not be provided in request body');
    }

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
    const notes = normalizeText(req.body?.notes, 2000);

    let credit_limit = 0;
    if (!isOperator && req.body?.credit_limit !== undefined) {
      const parsed = parseNumberStrict(req.body?.credit_limit);
      if (parsed === null) return badRequest(res, 'credit_limit must be a number');
      credit_limit = parsed;
    }

    const payment_terms = isOperator ? 'Net 30' : normalizeText(req.body?.payment_terms, 50) || 'Net 30';
    const is_active = isOperator ? true : req.body?.is_active === undefined ? true : !!req.body.is_active;

    if (!Number.isFinite(credit_limit) || credit_limit < 0) return badRequest(res, 'credit_limit must be >= 0');

    const exists = await query(
      `SELECT id FROM clients WHERE branch_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
      [branchId, email]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'Client with this email already exists in this branch' });
    }

    const result = await query(
      `INSERT INTO clients
       (branch_id, company_name, contact_person, phone, email, address, tax_id, credit_limit, current_balance, payment_terms, notes, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11)
       RETURNING ${CLIENT_COLUMNS}`,
      [
        branchId,
        company_name,
        contact_person,
        phone,
        email,
        address || null,
        tax_id || null,
        credit_limit,
        payment_terms,
        notes || null,
        is_active,
      ]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    if (error?.code === '23505') return res.status(409).json({ success: false, error: 'Conflict' });
    console.error('Create client error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * PUT /api/clients/:id  (admin/manager only)
 * Manager is restricted to their branch (cannot switch).
 */
router.put('/:id', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const branchFilter = await getBranchFilterForRead(req, res);
    if (branchFilter === undefined) return;

    if (req.body?.branch_id !== undefined) return badRequest(res, 'branch_id cannot be updated');
    if (req.body?.current_balance !== undefined) return badRequest(res, 'current_balance is system-managed');

    const existing = await query(
      `SELECT id, branch_id FROM clients
       WHERE id = $1 AND ($2::uuid IS NULL OR branch_id = $2)
       LIMIT 1`,
      [id, branchFilter]
    );
    if (existing.rows.length === 0) return notFound(res, 'Client not found');

    const targetBranchId = existing.rows[0]?.branch_id;
    if (typeof targetBranchId !== 'string' || !isUuid(targetBranchId)) return serverError(res);

    const company_name = req.body?.company_name === undefined ? undefined : normalizeText(req.body.company_name, 200);
    const contact_person = req.body?.contact_person === undefined ? undefined : normalizeText(req.body.contact_person, 200);
    const phone = req.body?.phone === undefined ? undefined : normalizeText(req.body.phone, 50);
    const email = req.body?.email === undefined ? undefined : normalizeEmail(req.body.email);

    const address = req.body?.address === undefined ? undefined : normalizeText(req.body.address, 500);
    const tax_id = req.body?.tax_id === undefined ? undefined : normalizeText(req.body.tax_id, 100);
    const notes = req.body?.notes === undefined ? undefined : normalizeText(req.body.notes, 2000);

    if (company_name !== undefined && !company_name) return badRequest(res, 'company_name cannot be empty');
    if (contact_person !== undefined && !contact_person) return badRequest(res, 'contact_person cannot be empty');
    if (phone !== undefined && !phone) return badRequest(res, 'phone cannot be empty');

    let credit_limit: number | undefined = undefined;
    if (req.body?.credit_limit !== undefined) {
      const parsed = parseNumberStrict(req.body?.credit_limit);
      if (parsed === null) return badRequest(res, 'credit_limit must be a number');
      if (parsed < 0) return badRequest(res, 'credit_limit must be >= 0');
      credit_limit = parsed;
    }

    const payment_terms =
      req.body?.payment_terms === undefined ? undefined : normalizeText(req.body.payment_terms, 50) || 'Net 30';

    const is_active = req.body?.is_active === undefined ? undefined : !!req.body.is_active;

    if (email !== undefined && !email) return badRequest(res, 'Invalid email');

    if (email !== undefined) {
      const dup = await query(
        `SELECT id FROM clients
         WHERE branch_id = $1 AND LOWER(email) = LOWER($2) AND id <> $3
         LIMIT 1`,
        [targetBranchId, email, id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ success: false, error: 'Client with this email already exists in this branch' });
      }
    }

    const fields: string[] = [];
    const params: any[] = [];
    let idx = 0;

    const pushField = (sql: string, val: any) => {
      idx += 1;
      fields.push(`${sql} = $${idx}`);
      params.push(val);
    };

    if (company_name !== undefined) pushField('company_name', company_name);
    if (contact_person !== undefined) pushField('contact_person', contact_person);
    if (phone !== undefined) pushField('phone', phone);
    if (email !== undefined) pushField('email', email);
    if (address !== undefined) pushField('address', address || null);
    if (tax_id !== undefined) pushField('tax_id', tax_id || null);
    if (notes !== undefined) pushField('notes', notes || null);
    if (credit_limit !== undefined) pushField('credit_limit', credit_limit);
    if (payment_terms !== undefined) pushField('payment_terms', payment_terms);
    if (is_active !== undefined) pushField('is_active', is_active);

    if (fields.length === 0) return badRequest(res, 'No fields to update');

    params.push(id, branchFilter);

    const updated = await query(
      `UPDATE clients
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${idx + 1}
         AND ($${idx + 2}::uuid IS NULL OR branch_id = $${idx + 2})
       RETURNING ${CLIENT_COLUMNS}`,
      params
    );

    return res.json({ success: true, data: updated.rows[0] });
  } catch (error: any) {
    if (error?.code === '23505') return res.status(409).json({ success: false, error: 'Conflict' });
    console.error('Update client error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * PATCH /api/clients/:id/status  { is_active: boolean }
 */
router.patch('/:id/status', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  const is_active_raw = (req.body as any)?.is_active;
  if (typeof is_active_raw !== 'boolean') return badRequest(res, 'is_active must be a boolean');

  try {
    const branchFilter = await getBranchFilterForRead(req, res);
    if (branchFilter === undefined) return;

    const existing = await query(
      `SELECT id FROM clients
       WHERE id = $1 AND ($2::uuid IS NULL OR branch_id = $2)
       LIMIT 1`,
      [id, branchFilter]
    );
    if (existing.rows.length === 0) return notFound(res, 'Client not found');

    const r = await query(
      `UPDATE clients
       SET is_active = $2, updated_at = NOW()
       WHERE id = $1
         AND ($3::uuid IS NULL OR branch_id = $3)
       RETURNING ${CLIENT_COLUMNS}`,
      [id, is_active_raw, branchFilter]
    );

    return res.json({ success: true, data: r.rows[0] });
  } catch (error: any) {
    console.error('Update client status error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

export default router;
