// apps/backend/src/routes/api/payments.ts
import { Router, Response } from 'express';
import { pool, query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

const router = Router();

// JWT-protected
router.use(authenticate);
router.use(requireRole(['operator', 'admin', 'manager']));

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

function normalizeText(v: unknown, maxLen = 500): string {
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
    if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), undefined;

    if (role === 'admin') return requestedBranch;

    const own = await resolveUserBranchId(userId);
    if (!own) return forbidden(res, 'User is not assigned to any branch'), undefined;
    if (own !== requestedBranch) return forbidden(res, 'You cannot switch branch context'), undefined;
    return own;
  }

  if (role === 'admin') return null;

  const own = await resolveUserBranchId(userId);
  if (!own) return forbidden(res, 'User is not assigned to any branch'), undefined;
  return own;
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

function genPaymentNumber(branchCode: string) {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `PAY-${branchCode}-${yy}${mm}-${rand}`;
}

function parsePaidAt(v: unknown): Date | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

const ALLOWED_METHODS = new Set(['cash', 'check', 'bank_transfer', 'credit_card', 'other']);

/**
 * Admin branch behavior:
 * Admin derives branch from invoice unless ?branch_id= is explicitly provided.
 */
async function getBranchForInvoiceAccess(req: AuthRequest, res: Response, invoiceId: string): Promise<string | null> {
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

    const inv = await query(`SELECT branch_id FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
    const bid = String(inv.rows?.[0]?.branch_id || '');
    if (!bid) return notFound(res, 'Invoice not found'), null;

    if (bid !== requestedBranch) return forbidden(res, 'Invoice is not in the requested branch'), null;
    return requestedBranch;
  }

  if (role === 'admin') {
    const inv = await query(`SELECT branch_id FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
    const bid = inv.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
    return notFound(res, 'Invoice not found'), null;
  }

  const own = await resolveUserBranchId(userId);
  if (!own) return forbidden(res, 'User is not assigned to any branch'), null;

  // Explicitly validate invoice belongs to own branch for cleaner behavior
  const ok = await query(`SELECT 1 FROM invoices WHERE id = $1 AND branch_id = $2 LIMIT 1`, [invoiceId, own]);
  if (ok.rows.length === 0) return notFound(res, 'Invoice not found'), null;

  return own;
}

/**
 * GET /api/payments
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const invoiceId = typeof req.query.invoice_id === 'string' ? req.query.invoice_id.trim() : '';

  const limitRaw = parseIntStrict(req.query.limit);
  const offsetRaw = parseIntStrict(req.query.offset);
  const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 500) : 200;
  const offset = offsetRaw !== null ? Math.max(offsetRaw, 0) : 0;

  try {
    if (invoiceId) {
      if (!isUuid(invoiceId)) return badRequest(res, 'invoice_id must be a UUID');

      const branchId = await getBranchForInvoiceAccess(req, res, invoiceId);
      if (!branchId) return;

      const r = await query(
        `
        SELECT
          id, branch_id, invoice_id,
          payment_number, payment_date, paid_at,
          amount, payment_method, reference_number, notes,
          created_at, created_by
        FROM payments
        WHERE invoice_id = $1
          AND branch_id = $2
        ORDER BY paid_at DESC NULLS LAST, created_at DESC
        LIMIT $3 OFFSET $4
        `,
        [invoiceId, branchId, limit, offset]
      );

      return res.json({ success: true, data: r.rows });
    }

    const branchFilter = await getBranchFilterForList(req, res);
    if (branchFilter === undefined) return;

    const r = await query(
      `
      SELECT
        id, branch_id, invoice_id,
        payment_number, payment_date, paid_at,
        amount, payment_method, reference_number, notes,
        created_at, created_by
      FROM payments
      WHERE ($1::uuid IS NULL OR branch_id = $1)
      ORDER BY paid_at DESC NULLS LAST, created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [branchFilter, limit, offset]
    );

    return res.json({ success: true, data: r.rows });
  } catch (error: any) {
    console.error('Get payments error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * POST /api/payments
 * record payment (admin/manager only)
 * Flow:
 * - lock invoice FOR UPDATE
 * - insert payment
 * - update invoice paid_amount/balance/status
 * - if credit client: decrease clients.current_balance AND customers.current_balance
 *
 * IMPORTANT: idempotency on (branch_id, reference_number) if reference_number is provided and non-empty.
 */
router.post('/', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const body = (req.body ?? {}) as any;

  const invoice_id = normalizeText(body.invoice_id ?? body.invoiceId, 80);
  if (!invoice_id || !isUuid(invoice_id)) return badRequest(res, 'invoice_id must be a UUID');

  const amount = parseNumberStrict(body.amount);
  if (amount === null || amount <= 0) return badRequest(res, 'amount must be a positive number');

  const payment_method_raw = normalizeText(body.payment_method ?? body.paymentMethod, 30).toLowerCase();
  const payment_method = payment_method_raw || 'cash';
  if (!ALLOWED_METHODS.has(payment_method)) return badRequest(res, 'Invalid payment_method');

  const reference_number = normalizeText(body.reference_number ?? body.referenceNumber, 120);
  const notes = normalizeText(body.notes, 2000);

  const paidAtDate = parsePaidAt(body.paid_at ?? body.paidAt) || new Date();
  const paid_at_iso = paidAtDate.toISOString();
  const payment_date = paid_at_iso.slice(0, 10);

  const actorId = req.user!.id;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const branchId = await getBranchForInvoiceAccess(req, res, invoice_id);
    if (!branchId) {
      await db.query('ROLLBACK');
      return;
    }

    const invRes = await db.query(
      `
      SELECT *
      FROM invoices
      WHERE id = $1 AND branch_id = $2
      FOR UPDATE
      `,
      [invoice_id, branchId]
    );

    if (invRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return notFound(res, 'Invoice not found');
    }

    const inv = invRes.rows[0];
    const status = String(inv.status || '').toLowerCase();

    if (status === 'cancelled') {
      await db.query('ROLLBACK');
      return badRequest(res, 'Cannot record payment for a cancelled invoice');
    }

    const total = Number(inv.total_amount ?? 0);
    const paid = Number(inv.paid_amount ?? 0);
    const balance = Number(inv.balance ?? Math.max(0, total - paid));
    const EPS = 0.01;

    if (balance <= EPS) {
      await db.query('ROLLBACK');
      return badRequest(res, 'Invoice is already fully paid');
    }
    if (amount > balance + EPS) {
      await db.query('ROLLBACK');
      return badRequest(res, `Payment exceeds invoice balance (${balance.toFixed(2)})`);
    }

    const branchCode = await getBranchCode(branchId);
    let payNo = genPaymentNumber(branchCode);

    let paymentRow: any = null;

    for (let i = 0; i < 3; i++) {
      try {
        const p = await db.query(
          `
          INSERT INTO payments
            (branch_id, invoice_id, payment_number, payment_date, paid_at, amount,
             payment_method, reference_number, notes, created_by)
          VALUES
            ($1,$2,$3,$4,$5,$6,
             $7,$8,$9,$10)
          RETURNING *
          `,
          [
            branchId,
            invoice_id,
            payNo,
            payment_date,
            paid_at_iso,
            amount,
            payment_method,
            reference_number || '',
            notes || '',
            actorId,
          ]
        );
        paymentRow = p.rows[0];
        break;
      } catch (e: any) {
        // Critical: differentiate unique constraint failures
        if (e?.code === '23505') {
          const constraint = String(e?.constraint || '');

          // Idempotency on reference_number (from migration 008)
          if (constraint === 'uq_payments_branch_reference_number' && reference_number) {
            // Return existing payment + current invoice state
            const existingPay = await db.query(
              `
              SELECT *
              FROM payments
              WHERE branch_id = $1
                AND reference_number = $2
              ORDER BY paid_at DESC NULLS LAST, created_at DESC
              LIMIT 1
              `,
              [branchId, reference_number]
            );

            const existingInv = await db.query(`SELECT * FROM invoices WHERE id = $1 AND branch_id = $2 LIMIT 1`, [
              invoice_id,
              branchId,
            ]);

            await db.query('ROLLBACK');
            return res.json({
              success: true,
              data: { payment: existingPay.rows[0], invoice: existingInv.rows[0] },
              meta: { idempotent: true, reason: 'duplicate reference_number' },
            });
          }

          // Otherwise assume payment_number collision and retry with a new payment number
          payNo = genPaymentNumber(branchCode);
          continue;
        }

        throw e;
      }
    }

    if (!paymentRow) {
      await db.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'Could not generate unique payment number' });
    }

    const newPaid = paid + amount;
    const newBal = Math.max(0, total - newPaid);

    const newStatus = newBal <= EPS ? 'paid' : status === 'overdue' ? 'overdue' : 'sent';

    const updInv = await db.query(
      `
      UPDATE invoices
      SET
        paid_amount = $1,
        balance = $2,
        status = $3,
        updated_at = NOW()
      WHERE id = $4 AND branch_id = $5
      RETURNING *
      `,
      [newPaid, newBal, newStatus, invoice_id, branchId]
    );

    // Reduce balances for credit customers (client_id exists)
    const clientId = inv.client_id ? String(inv.client_id) : '';
    if (clientId && isUuid(clientId)) {
      await db.query(
        `
        UPDATE clients
        SET current_balance = GREATEST(COALESCE(current_balance, 0) - $1, 0),
            updated_at = NOW()
        WHERE id = $2 AND branch_id = $3
        `,
        [amount, clientId, branchId]
      );

      // Also reduce CUSTOMER balance (global)
      let customerId = inv.customer_id ? String(inv.customer_id) : '';
      if (!customerId) {
        const cr = await db.query(`SELECT customer_id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [
          clientId,
          branchId,
        ]);
        customerId = cr.rows?.[0]?.customer_id ? String(cr.rows[0].customer_id) : '';
      }

      if (customerId && isUuid(customerId)) {
        await db.query(
          `
          UPDATE customers
          SET current_balance = GREATEST(COALESCE(current_balance, 0) - $1, 0),
              updated_at = NOW()
          WHERE id = $2
          `,
          [amount, customerId]
        );
      }
    }

    await db.query('COMMIT');
    return res.json({ success: true, data: { payment: paymentRow, invoice: updInv.rows[0] } });
  } catch (error: any) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('Record payment error', { code: error?.code, message: error?.message });
    return serverError(res);
  } finally {
    db.release();
  }
});

export default router;
