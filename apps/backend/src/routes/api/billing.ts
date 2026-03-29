// apps/backend/src/routes/api/billing.ts
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

function parseISODateStrict(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonthISO(iso: string) {
  return iso.slice(0, 7) + '-01';
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

async function getBranchCode(branchId: string): Promise<string> {
  try {
    const r = await query(`SELECT code FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
    const code = String(r.rows?.[0]?.code || '').trim();
    return code || 'BR';
  } catch {
    return 'BR';
  }
}

function genInvoiceNumber(branchCode: string) {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `INV-${branchCode}-${yy}${mm}-${rand}`;
}

/**
 * Deterministic advisory lock key using md5(text) -> first 16 hex chars -> 64-bit bigint.
 * This prevents concurrent monthly-cutoff runs for the same customer+period.
 */
async function advisoryLockMonthlyCutoff(
  db: { query: (q: string, p?: any[]) => Promise<any> },
  keyText: string
) {
  await db.query(
    `SELECT pg_advisory_xact_lock( ('x' || substr(md5($1), 1, 16))::bit(64)::bigint )`,
    [keyText]
  );
}

/**
 * POST /api/billing/monthly-cutoff
 * Body:
 *  - customer_id (required)
 *  - cutoff_date (optional YYYY-MM-DD, default today)
 *
 * Idempotency / Double-run protection:
 *  - If a monthly invoice already exists for the same (customer_id + period_start + period_end + cutoff_date),
 *    return it instead of creating a new one.
 */
router.post('/monthly-cutoff', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const role = req.user?.role || '';
  const userId = req.user?.id || '';
  if (!userId) return forbidden(res, 'Unauthorized');

  const b: any = req.body || {};
  const customer_id = normalizeText(b.customer_id ?? b.customerId, 80);
  if (!customer_id || !isUuid(customer_id)) return badRequest(res, 'customer_id must be a UUID');

  const cutoffInput = b.cutoff_date ?? b.cutoffDate;
  const cutoff_date = cutoffInput ? parseISODateStrict(cutoffInput) : todayISO();
  if (!cutoff_date) return badRequest(res, 'cutoff_date must be in YYYY-MM-DD format');

  const period_start = firstDayOfMonthISO(cutoff_date);
  const period_end = cutoff_date;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    // Prevent concurrent double-run for same customer + same period
    await advisoryLockMonthlyCutoff(
      db,
      `monthly-cutoff:${customer_id}:${period_start}:${period_end}:${cutoff_date}`
    );

    // Idempotency check: if invoice already exists for this period, return it
    {
      const ex = await db.query(
        `
        SELECT *
        FROM invoices
        WHERE invoice_type = 'monthly'
          AND customer_id = $1
          AND billing_period_start = $2::date
          AND billing_period_end = $3::date
          AND cutoff_date = $4::date
          AND status <> 'cancelled'
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [customer_id, period_start, period_end, cutoff_date]
      );

      if (ex.rows.length > 0) {
        const inv = ex.rows[0];

        const itemsCount = await db.query(
          `SELECT COUNT(*)::int AS count FROM invoice_line_items WHERE invoice_id = $1`,
          [inv.id]
        );

        await db.query('COMMIT');
        return res.json({
          success: true,
          data: {
            invoice: inv,
            period: { start: period_start, end: period_end, cutoff_date },
            charges_count: itemsCount.rows?.[0]?.count ?? null,
            totals: {
              subtotal: Number(inv.subtotal ?? 0),
              tax_rate: Number(inv.tax_rate ?? 5),
              tax_amount: Number(inv.tax_amount ?? 0),
              total_amount: Number(inv.total_amount ?? 0),
            },
          },
          meta: { existing: true },
        });
      }
    }

    // Lock customer row
    const custRes = await db.query(`SELECT * FROM customers WHERE id = $1 FOR UPDATE`, [customer_id]);
    if (custRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return notFound(res, 'Customer not found');
    }
    const cust = custRes.rows[0];

    const primaryBranchId = String(cust.primary_branch_id || '').trim();

    // manager restriction
    if (role === 'manager') {
      const own = await resolveUserBranchId(userId);
      if (!own) {
        await db.query('ROLLBACK');
        return forbidden(res, 'User is not assigned to any branch');
      }
      if (!primaryBranchId || primaryBranchId !== own) {
        await db.query('ROLLBACK');
        return forbidden(res, 'Managers can only generate cut-off invoices for customers in their primary branch');
      }
    }

    if (!primaryBranchId || !isUuid(primaryBranchId)) {
      await db.query('ROLLBACK');
      return badRequest(
        res,
        'Customer has no primary_branch_id. Set primary branch first (customers/:id/set-primary-branch).'
      );
    }

    // Find a branch account client_id for invoice (prefer primary branch account)
    const clientRes = await db.query(
      `SELECT id, payment_terms FROM clients WHERE customer_id = $1 AND branch_id = $2 LIMIT 1`,
      [customer_id, primaryBranchId]
    );
    if (clientRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return badRequest(res, 'Customer is not attached to primary branch. Attach branch first.');
    }
    const client_id = clientRes.rows[0].id;
    const payment_terms = String(clientRes.rows[0].payment_terms || cust.payment_terms || 'Net 30');

    // Lock charges to avoid double-billing
    const chargesRes = await db.query(
      `
      SELECT
        bc.*,
        t.transaction_number,
        t.first_weight,
        t.second_weight,
        t.net_weight,
        t.material_type,
        t.reference_number,
        t.assigned_truck_id,
        t.truck_side_number
      FROM billing_charges bc
      LEFT JOIN transactions t ON t.id = bc.transaction_id
      WHERE bc.customer_id = $1
        AND bc.status = 'unbilled'
        AND bc.service_date >= $2::date
        AND bc.service_date <= $3::date
      ORDER BY bc.service_date ASC, bc.created_at ASC
      FOR UPDATE
      `,
      [customer_id, period_start, period_end]
    );

    if (chargesRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return badRequest(res, 'No unbilled charges found for that period');
    }

    // Collect exact locked charge IDs
    const chargeIds: string[] = (chargesRes.rows as any[])
      .map((r) => String(r.id || '').trim())
      .filter((id) => isUuid(id));

    if (chargeIds.length !== chargesRes.rows.length) {
      await db.query('ROLLBACK');
      return serverError(res);
    }

    // Totals are derived from charges (already include GST snapshot)
    let subtotal = 0;
    let tax_amount = 0;
    let total_amount = 0;

    for (const ch of chargesRes.rows as any[]) {
      subtotal += Number(ch.subtotal ?? 0);
      tax_amount += Number(ch.tax_amount ?? 0);
      total_amount += Number(ch.total_amount ?? 0);
    }

    const tax_rate = 5;

    const invoice_date = cutoff_date;
    const due = new Date(`${cutoff_date}T00:00:00Z`);
    due.setDate(due.getDate() + 30);
    const due_date = due.toISOString().slice(0, 10);

    const branchCode = await getBranchCode(primaryBranchId);
    let invoice_number = genInvoiceNumber(branchCode);

    let invoiceRow: any = null;
    for (let i = 0; i < 3; i++) {
      try {
        const invIns = await db.query(
          `
          INSERT INTO invoices
            (branch_id, client_id, customer_id,
             invoice_type, billing_period_start, billing_period_end, cutoff_date,
             invoice_number, invoice_date, due_date,
             subtotal, tax_rate, tax_amount, total_amount,
             paid_amount, balance, status, payment_terms, notes)
          VALUES
            ($1,$2,$3,
             'monthly', $4::date, $5::date, $6::date,
             $7, $8::date, $9::date,
             $10,$11,$12,$13,
             0,$13,'sent',$14,$15)
          RETURNING *
          `,
          [
            primaryBranchId,
            client_id,
            customer_id,
            period_start,
            period_end,
            cutoff_date,
            invoice_number,
            invoice_date,
            due_date,
            subtotal,
            tax_rate,
            tax_amount,
            total_amount,
            payment_terms,
            `Monthly cut-off invoice for ${period_start} to ${period_end}`,
          ]
        );
        invoiceRow = invIns.rows[0];
        break;
      } catch (e: any) {
        if (e?.code === '23505') {
          // Could be invoice_number collision OR (if you later add a unique period index) period collision.
          // Re-check for existing period invoice and return it if found.
          const ex = await db.query(
            `
            SELECT *
            FROM invoices
            WHERE invoice_type = 'monthly'
              AND customer_id = $1
              AND billing_period_start = $2::date
              AND billing_period_end = $3::date
              AND cutoff_date = $4::date
              AND status <> 'cancelled'
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [customer_id, period_start, period_end, cutoff_date]
          );

          if (ex.rows.length > 0) {
            invoiceRow = ex.rows[0];
            break;
          }

          invoice_number = genInvoiceNumber(branchCode);
          continue;
        }
        throw e;
      }
    }

    if (!invoiceRow) {
      await db.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'Could not generate unique invoice number' });
    }

    // Create line items from charges
    for (const ch of chargesRes.rows as any[]) {
      const txNo = String(ch.transaction_number || '');
      const net = Number(ch.net_weight ?? 0);

      const desc =
        txNo
          ? `Weighing ${txNo} — net: ${net.toFixed(2)}kg`
          : `Weighing service — ${String(ch.service_date || '')}`;

      const qty =
        ch.pricing_quantity !== null && ch.pricing_quantity !== undefined && Number(ch.pricing_quantity) > 0
          ? Number(ch.pricing_quantity)
          : 1;

      const unit_price =
        ch.pricing_unit_price !== null && ch.pricing_unit_price !== undefined && Number(ch.pricing_unit_price) >= 0
          ? Number(ch.pricing_unit_price)
          : Number(ch.subtotal ?? 0);

      await db.query(
        `
        INSERT INTO invoice_line_items
          (invoice_id, transaction_id, description, quantity, unit_price, amount)
        VALUES
          ($1,$2,$3,$4,$5,$6)
        `,
        [invoiceRow.id, ch.transaction_id || null, desc, qty, unit_price, Number(ch.subtotal ?? 0)]
      );
    }

    // IMPORTANT: mark ONLY the selected charges as billed
    const upd = await db.query(
      `
      UPDATE billing_charges
      SET status = 'billed',
          billed_invoice_id = $1,
          updated_at = NOW()
      WHERE customer_id = $2
        AND id = ANY($3::uuid[])
        AND status = 'unbilled'
      `,
      [invoiceRow.id, customer_id, chargeIds]
    );

    if (upd.rowCount !== chargeIds.length) {
      await db.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: 'Charge billing mismatch: not all selected charges were updated. Please retry.',
      });
    }

    await db.query('COMMIT');

    return res.json({
      success: true,
      data: {
        invoice: invoiceRow,
        period: { start: period_start, end: period_end, cutoff_date },
        charges_count: chargesRes.rows.length,
        totals: { subtotal, tax_rate, tax_amount, total_amount },
      },
    });
  } catch (e: any) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('Monthly cutoff error', { code: e?.code, message: e?.message });
    return serverError(res);
  } finally {
    db.release();
  }
});

export default router;
