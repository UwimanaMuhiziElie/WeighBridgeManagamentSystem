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

function normalizeText(v: unknown, maxLen = 255): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function parseNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

// DB schema allows inbound/outbound only
const ALLOWED_TRANSACTION_TYPES = new Set(['inbound', 'outbound']);

// ----- branch scoping helpers -----
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

// ----- pricing helpers -----
function calcSubtotal(netWeight: number, tier: any | null, cp: any | null) {
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

  const breakdown =
    `Weighing: ${weighingCharge.toFixed(2)} + ` +
    `Weight (${netWeight.toFixed(2)}kg × ${ppk.toFixed(2)}): ${weightCharge.toFixed(2)}` +
    (discount > 0 ? ` - ${discount}% discount` : '') +
    (min > 0 ? ` (min ${min.toFixed(2)})` : '');

  return { subtotal, breakdown, applied: { ppw, ppk, min, discount } };
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

function genTxNumber(branchCode: string) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TXN-${branchCode}-${y}${m}${day}-${rand}`;
}

function genInvoiceNumber(branchCode: string) {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `INV-${branchCode}-${yy}${mm}-${rand}`;
}

function getIdempotencyKey(req: AuthRequest) {
  const h = req.headers['idempotency-key'];
  const headerVal = Array.isArray(h) ? h[0] : (typeof h === 'string' ? h : '');
  const bodyVal = typeof (req.body as any)?.idempotency_key === 'string' ? String((req.body as any).idempotency_key) : '';
  const v = (headerVal || bodyVal || '').trim();
  return v ? v.slice(0, 120) : '';
}

/**
 * GET /api/transactions?limit=50
 * Needed for desktop TransactionsPage (not extra; it’s ops visibility).
 */
router.get(
  '/',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    const branchId = await getScopedBranchId(req, res);
    if (!branchId) return;

    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    try {
      const r = await query(
        `
        SELECT
          t.id,
          t.transaction_number,
          t.status,
          t.transaction_type,
          t.net_weight,
          t.material_type,
          t.reference_number,
          t.created_at,
          c.company_name,
          v.license_plate,
          v.vehicle_type
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.branch_id = $1
        ORDER BY t.created_at DESC
        LIMIT $2
        `,
        [branchId, limit]
      );

      return res.json({ success: true, data: r.rows });
    } catch (error: any) {
      console.error('List transactions error', { code: error?.code, message: error?.message });
      return serverError(res);
    }
  }
);

/**
 * POST /api/transactions
 * Records FIRST weight only (pending)
 * ✅ Idempotent using Idempotency-Key / body.idempotency_key
 */
router.post(
  '/',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    const branchId = await getScopedBranchId(req, res);
    if (!branchId) return;

    const role = req.user!.role;

    const client_id = normalizeText(req.body?.client_id, 80);
    const vehicle_id = normalizeText(req.body?.vehicle_id, 80);
    const bodyOperatorId = normalizeText(req.body?.operator_id, 80);

    const operator_id = role === 'operator' ? req.user!.id : bodyOperatorId;
    if (role !== 'operator' && !operator_id) return badRequest(res, 'operator_id is required for admin/manager');

    const transaction_type = normalizeText(req.body?.transaction_type, 30).toLowerCase();
    const firstWeight = parseNumber(req.body?.first_weight);

    if (!client_id) return badRequest(res, 'client_id is required');
    if (!vehicle_id) return badRequest(res, 'vehicle_id is required');
    if (!operator_id) return badRequest(res, 'operator_id is required');

    if (!isUuid(client_id)) return badRequest(res, 'client_id must be a UUID');
    if (!isUuid(vehicle_id)) return badRequest(res, 'vehicle_id must be a UUID');
    if (!isUuid(operator_id)) return badRequest(res, 'operator_id must be a UUID');

    if (!transaction_type) return badRequest(res, 'transaction_type is required');
    if (!ALLOWED_TRANSACTION_TYPES.has(transaction_type)) return badRequest(res, 'transaction_type must be inbound or outbound');

    if (firstWeight === null) return badRequest(res, 'first_weight must be a number');
    if (firstWeight < 0) return badRequest(res, 'first_weight must be >= 0');

    const material_type = normalizeText(req.body?.material_type, 80);
    const reference_number = normalizeText(req.body?.reference_number, 80);
    const notes = normalizeText(req.body?.notes, 2000);

    const idemKey = getIdempotencyKey(req);

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      // ✅ If request already processed, return existing transaction
      if (idemKey) {
        const ex = await db.query(
          `SELECT * FROM transactions WHERE branch_id = $1 AND client_request_id = $2 LIMIT 1`,
          [branchId, idemKey]
        );
        if (ex.rows.length > 0) {
          await db.query('COMMIT');
          return res.json({ success: true, data: ex.rows[0] });
        }
      }

      // client must belong to branch
      const c = await db.query(`SELECT id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [client_id, branchId]);
      if (c.rows.length === 0) {
        await db.query('ROLLBACK');
        return notFound(res, 'Client not found for this branch');
      }

      // vehicle must belong to branch via client join
      const v = await db.query(
        `
        SELECT v.id
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

      const branchCode = await getBranchCode(branchId);

      // retry on rare transaction_number collision
      let txNumber = genTxNumber(branchCode);

      for (let i = 0; i < 3; i++) {
        try {
          const ins = await db.query(
            `
            INSERT INTO transactions
              (branch_id, transaction_number, client_id, vehicle_id, operator_id,
               transaction_type, status, first_weight, first_weight_time,
               material_type, reference_number, notes,
               client_request_id)
            VALUES
              ($1,$2,$3,$4,$5,$6,'pending',$7,NOW(),$8,$9,$10,$11)
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
              material_type,
              reference_number,
              notes,
              idemKey || null,
            ]
          );

          await db.query('COMMIT');
          return res.status(201).json({ success: true, data: ins.rows[0] });
        } catch (e: any) {
          if (e?.code === '23505') {
            // If idempotency key collided, fetch and return existing
            if (idemKey) {
              const ex2 = await db.query(
                `SELECT * FROM transactions WHERE branch_id = $1 AND client_request_id = $2 LIMIT 1`,
                [branchId, idemKey]
              );
              if (ex2.rows.length > 0) {
                await db.query('COMMIT');
                return res.json({ success: true, data: ex2.rows[0] });
              }
            }

            // Otherwise retry with a new tx number
            txNumber = genTxNumber(branchCode);
            continue;
          }
          throw e;
        }
      }

      await db.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'Could not generate unique transaction number' });
    } catch (error: any) {
      try { await db.query('ROLLBACK'); } catch {}
      console.error('Create transaction error', { code: error?.code, message: error?.message });
      return serverError(res);
    } finally {
      db.release();
    }
  }
);

/**
 * PATCH /api/transactions/:id/complete
 * Records SECOND weight, completes transaction, calculates price, creates invoice, saves it.
 * ✅ Idempotent: calling twice returns the same invoice (no duplicates).
 */
router.patch(
  '/:id/complete',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    const branchId = await getScopedBranchId(req, res);
    if (!branchId) return;

    const id = String(req.params.id || '').trim();
    if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

    const secondWeight = parseNumber(req.body?.second_weight);
    if (secondWeight === null) return badRequest(res, 'second_weight must be a number');
    if (secondWeight < 0) return badRequest(res, 'second_weight must be >= 0');

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      // lock transaction row
      const tRes = await db.query(
        `SELECT * FROM transactions WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
        [id, branchId]
      );
      if (tRes.rows.length === 0) {
        await db.query('ROLLBACK');
        return notFound(res, 'Transaction not found');
      }

      const tx = tRes.rows[0];

      // ✅ Operators can only complete their own transactions (minimum production safety)
      if (req.user?.role === 'operator' && String(tx.operator_id) !== String(req.user.id)) {
        await db.query('ROLLBACK');
        return forbidden(res, 'You can only complete your own transactions');
      }

      // If already completed, enforce idempotency behavior:
      if (tx.status === 'completed') {
        const existingSecond = Number(tx.second_weight);
        // If caller sends a different value, reject (prevents silent corruption)
        if (Number.isFinite(existingSecond) && Math.abs(existingSecond - secondWeight) > 0.0001) {
          await db.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            error: `Transaction already completed with second_weight=${existingSecond}.`,
          });
        }

        // Return existing invoice if present
        const inv = await db.query(
          `SELECT * FROM invoices WHERE branch_id = $1 AND transaction_id = $2 LIMIT 1`,
          [branchId, tx.id]
        );

        await db.query('COMMIT');
        return res.json({
          success: true,
          data: {
            transaction: tx,
            invoice: inv.rows[0] || null,
            pricing: null,
          },
        });
      }

      if (tx.status !== 'pending' && tx.status !== 'in_progress') {
        await db.query('ROLLBACK');
        return badRequest(res, 'Transaction is not pending');
      }

      const firstWeight = Number(tx.first_weight ?? 0);
      if (!Number.isFinite(firstWeight)) {
        await db.query('ROLLBACK');
        return badRequest(res, 'Transaction first_weight is invalid');
      }

      const netWeight = Math.abs(firstWeight - secondWeight);

      // Get client payment terms (optional)
      const cRes = await db.query(`SELECT payment_terms FROM clients WHERE id = $1 LIMIT 1`, [tx.client_id]);
      const paymentTerms = String(cRes.rows?.[0]?.payment_terms || 'Net 30');

      // pricing
      const defaultTier = await getDefaultTier(branchId, db);
      const clientPricing = await getClientPricing(tx.client_id, db);
      const { subtotal, breakdown, applied } = calcSubtotal(netWeight, defaultTier, clientPricing);

      const tax_rate = 0;
      const tax_amount = 0;
      const total_amount = subtotal;

      const due = new Date();
      due.setDate(due.getDate() + 30);

      const branchCode = await getBranchCode(branchId);

      // ✅ Idempotency anchor: invoice.transaction_id must be unique
      // If invoice already exists (e.g. retry after partial UI failure), reuse it.
      let invoiceRow: any = null;

      const existingInv = await db.query(
        `SELECT * FROM invoices WHERE branch_id = $1 AND transaction_id = $2 LIMIT 1`,
        [branchId, tx.id]
      );
      if (existingInv.rows.length > 0) {
        invoiceRow = existingInv.rows[0];
      } else {
        // create invoice (retry collisions)
        let invoiceNumber = genInvoiceNumber(branchCode);

        for (let i = 0; i < 5; i++) {
          try {
            const invIns = await db.query(
              `
              INSERT INTO invoices
                (branch_id, client_id, transaction_id, invoice_number, invoice_date, due_date,
                 subtotal, tax_rate, tax_amount, total_amount, paid_amount, balance,
                 status, payment_terms, notes)
              VALUES
                ($1,$2,$3,$4,CURRENT_DATE,$5,
                 $6,$7,$8,$9,0,$9,
                 'sent',$10,$11)
              RETURNING *
              `,
              [
                branchId,
                tx.client_id,
                tx.id, // ✅ unique per tx
                invoiceNumber,
                due.toISOString().slice(0, 10),
                subtotal,
                tax_rate,
                tax_amount,
                total_amount,
                paymentTerms,
                `Auto from ${tx.transaction_number}`,
              ]
            );
            invoiceRow = invIns.rows[0];
            break;
          } catch (e: any) {
            // 23505 = unique violation (invoice_number OR transaction_id)
            if (e?.code === '23505') {
              // If transaction_id uniqueness was hit (race), fetch existing and return it
              const raced = await db.query(
                `SELECT * FROM invoices WHERE branch_id = $1 AND transaction_id = $2 LIMIT 1`,
                [branchId, tx.id]
              );
              if (raced.rows.length > 0) {
                invoiceRow = raced.rows[0];
                break;
              }

              // Otherwise regenerate invoice number and retry
              invoiceNumber = genInvoiceNumber(branchCode);
              continue;
            }
            throw e;
          }
        }

        if (!invoiceRow) {
          await db.query('ROLLBACK');
          return res.status(409).json({ success: false, error: 'Could not create invoice (unique conflicts)' });
        }

        // invoice line item (only if we just created invoice or if none exists yet)
        const liExists = await db.query(
          `SELECT 1 FROM invoice_line_items WHERE invoice_id = $1 LIMIT 1`,
          [invoiceRow.id]
        );

        if (liExists.rows.length === 0) {
          const desc =
            `Weighing ${tx.transaction_number} — first: ${firstWeight.toFixed(2)}kg, ` +
            `second: ${secondWeight.toFixed(2)}kg, net: ${netWeight.toFixed(2)}kg`;

          await db.query(
            `
            INSERT INTO invoice_line_items
              (invoice_id, transaction_id, description, quantity, unit_price, amount)
            VALUES
              ($1,$2,$3,1,$4,$4)
            `,
            [invoiceRow.id, tx.id, desc, subtotal]
          );
        }
      }

      // complete transaction
      const upd = await db.query(
        `
        UPDATE transactions
        SET
          second_weight = $1,
          net_weight = $2,
          second_weight_time = NOW(),
          status = 'completed',
          updated_at = NOW()
        WHERE id = $3 AND branch_id = $4
        RETURNING *
        `,
        [secondWeight, netWeight, tx.id, branchId]
      );

      await db.query('COMMIT');

      return res.json({
        success: true,
        data: {
          transaction: upd.rows[0],
          invoice: invoiceRow,
          pricing: {
            subtotal,
            tax_rate,
            tax_amount,
            total: total_amount,
            breakdown,
            applied,
            defaultTierId: defaultTier?.id ?? null,
            clientPricingId: clientPricing?.id ?? null,
          },
        },
      });
    } catch (error: any) {
      try { await db.query('ROLLBACK'); } catch {}
      console.error('Complete transaction error', { code: error?.code, message: error?.message });
      return serverError(res);
    } finally {
      db.release();
    }
  }
);

export default router;
