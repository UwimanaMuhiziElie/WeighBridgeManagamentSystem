import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../../db.js';

const router = Router();

// ---- config ----
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const WEBHOOK_MAX_SKEW_SEC = Number(process.env.WEBHOOK_MAX_SKEW_SEC || 300); // 5 min

function mustGetWebhookSecret() {
  if (!WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET is not set');
  return WEBHOOK_SECRET;
}

type RawBodyRequest = Request & { rawBody?: Buffer };

// ---- helpers ----
function normalizeText(v: unknown, maxLen = 255): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function parseDateOrNow(v: unknown): Date {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function getHeader(req: Request, name: string): string {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] || '';
  return typeof v === 'string' ? v : '';
}

function extractSignature(sigHeaderRaw: string): string {
  // Accept:
  // - "<hex>"
  // - "sha256=<hex>"
  // - "v1=<hex>"
  const s = sigHeaderRaw.trim();
  if (!s) return '';
  const m = s.match(/^(?:sha256=|v1=)?([0-9a-f]{64})$/i);
  return m ? m[1].toLowerCase() : '';
}

function safeEqualHex(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function computeHmac(secret: string, payload: Buffer | string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Signature middleware.
 *
 * Requires server.ts to store req.rawBody (see notes below).
 * Headers supported:
 * - x-webhook-signature: "<hex>" or "sha256=<hex>" or "v1=<hex>"
 * Optional anti-replay:
 * - x-webhook-timestamp: unix seconds
 *   if present, we sign `${timestamp}.${rawBody}`
 */
function verifyWebhookSignature(req: RawBodyRequest, res: Response, next: NextFunction) {
  const sigHeader = getHeader(req, 'x-webhook-signature') || getHeader(req, 'x-signature');
  const sig = extractSignature(sigHeader);

  if (!sig) {
    return res.status(401).json({ success: false, error: 'Missing or invalid signature' });
  }

  const raw = req.rawBody;
  if (!raw || !Buffer.isBuffer(raw) || raw.length === 0) {
    // This means your server is misconfigured (rawBody not captured).
    return res.status(500).json({ success: false, error: 'Webhook endpoint not configured' });
  }

  const secret = mustGetWebhookSecret();

  const tsRaw = getHeader(req, 'x-webhook-timestamp');
  if (tsRaw) {
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) {
      return res.status(401).json({ success: false, error: 'Invalid timestamp' });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > WEBHOOK_MAX_SKEW_SEC) {
      return res.status(401).json({ success: false, error: 'Stale timestamp' });
    }

    const expected = computeHmac(secret, `${tsRaw}.${raw.toString('utf8')}`);
    if (!safeEqualHex(sig, expected)) {
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }

    return next();
  }

  // No timestamp mode: sign raw body
  const expected = computeHmac(secret, raw);
  if (!safeEqualHex(sig, expected)) {
    return res.status(401).json({ success: false, error: 'Invalid signature' });
  }

  return next();
}

async function nextPaymentNumber(
  dbClient: { query: (text: string, params?: any[]) => Promise<any> },
  branchId: string
) {
  const year = new Date().getFullYear();
  const counterRes = await dbClient.query(
    `INSERT INTO payment_counters (branch_id, year, last_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (branch_id, year)
     DO UPDATE SET last_number = payment_counters.last_number + 1
     RETURNING last_number`,
    [branchId, year]
  );

  const n = Number(counterRes.rows[0].last_number);
  return `PAY-${year}-${String(n).padStart(6, '0')}`;
}

function getEventId(req: Request, body: any): string {
  // Prefer header if present
  const h =
    getHeader(req, 'x-webhook-id') ||
    getHeader(req, 'x-event-id') ||
    getHeader(req, 'x-request-id');

  const fromHeader = normalizeText(h, 120);
  if (fromHeader) return fromHeader;

  // Fall back to payload fields
  const fromBody =
    normalizeText(body?.event_id, 120) ||
    normalizeText(body?.data?.event_id, 120);

  return fromBody;
}

// ---- route ----
// POST /integrations/webhooks
router.post('/', verifyWebhookSignature, async (req: RawBodyRequest, res: Response) => {
  try {
    const event_type = normalizeText((req.body as any)?.event_type, 60);
    const branch_id = normalizeText((req.body as any)?.branch_id, 80);
    const data = (req.body as any)?.data;

    const event_id = getEventId(req, req.body);

    if (!event_id) {
      // Production requirement: without idempotency, webhook retries can double-charge.
      return res.status(400).json({ success: false, error: 'event_id is required (for idempotency)' });
    }

    if (!event_type || !data) {
      return res.status(400).json({ success: false, error: 'Missing event_type or data' });
    }

    if (!branch_id || !isUuid(branch_id)) {
      return res.status(400).json({ success: false, error: 'branch_id must be a UUID' });
    }

    // Optional: ensure branch exists/active (recommended)
    // (If your branches table/columns differ, adjust.)
    {
      const check = await pool.query(
        `SELECT id FROM branches WHERE id = $1 AND is_active = true LIMIT 1`,
        [branch_id]
      );
      if (check.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Branch not found' });
      }
    }

    switch (event_type) {
      case 'invoice.paid': {
        const invoice_id = normalizeText(data?.invoice_id, 80);
        const payment_amount = normalizeNumber(data?.payment_amount);
        const payment_method = normalizeText(data?.payment_method, 40) || 'bank_transfer';
        const payment_date = parseDateOrNow(data?.payment_date);

        if (!invoice_id || !isUuid(invoice_id)) {
          return res.status(400).json({ success: false, error: 'invoice_id must be a UUID' });
        }
        if (payment_amount === null || payment_amount <= 0) {
          return res.status(400).json({ success: false, error: 'payment_amount must be a positive number' });
        }
        if (payment_amount > 1_000_000_000_000) {
          return res.status(400).json({ success: false, error: 'payment_amount is unrealistically large' });
        }

        const reference_number = `WEBHOOK-${event_id}`;

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Idempotency: if already processed, return success without changing state
          const existing = await client.query(
            `SELECT id, payment_number
             FROM payments
             WHERE branch_id = $1 AND reference_number = $2
             LIMIT 1`,
            [branch_id, reference_number]
          );
          if (existing.rows.length > 0) {
            await client.query('COMMIT');
            return res.json({
              success: true,
              message: 'Already processed',
              data: { invoice_id, payment_number: existing.rows[0].payment_number, reference_number },
            });
          }

          // Lock invoice row to avoid concurrent updates
          const invoiceRes = await client.query(
            `SELECT id, branch_id, total_amount, paid_amount, balance, status
             FROM invoices
             WHERE id = $1 AND branch_id = $2
             FOR UPDATE`,
            [invoice_id, branch_id]
          );

          if (invoiceRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Invoice not found' });
          }

          const invoice = invoiceRes.rows[0];
          const paymentNumber = await nextPaymentNumber(client, branch_id);

          await client.query(
            `INSERT INTO payments
             (branch_id, invoice_id, payment_number, payment_date, amount, payment_method, reference_number, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              branch_id,
              invoice_id,
              paymentNumber,
              payment_date,
              payment_amount,
              payment_method,
              reference_number,
              `Payment received via webhook (${event_type})`,
            ]
          );

          const total = Number(invoice.total_amount ?? 0);
          const oldPaid = Number(invoice.paid_amount ?? 0);

          const newPaid = oldPaid + payment_amount;
          const newBalanceRaw = total - newPaid;
          const newBalance = newBalanceRaw < 0 ? 0 : newBalanceRaw;

          const newStatus =
            newBalance <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : (invoice.status || 'unpaid'));

          await client.query(
            `UPDATE invoices
             SET paid_amount = $1, balance = $2, status = $3, updated_at = NOW()
             WHERE id = $4 AND branch_id = $5`,
            [newPaid, newBalance, newStatus, invoice_id, branch_id]
          );

          await client.query('COMMIT');

          return res.json({
            success: true,
            message: 'Payment recorded successfully',
            data: {
              invoice_id,
              payment_number: paymentNumber,
              reference_number,
              paid_amount: newPaid,
              balance: newBalance,
              status: newStatus,
            },
          });
        } catch (e: any) {
          try { await client.query('ROLLBACK'); } catch {}
          console.error('Webhook invoice.paid error', { code: e?.code, message: e?.message });
          return res.status(500).json({ success: false, error: 'Internal server error' });
        } finally {
          client.release();
        }
      }

      case 'transaction.created':
      case 'client.updated':
        return res.json({ success: true, message: 'Webhook received', event_type, event_id });

      default:
        return res.status(400).json({ success: false, error: 'Unknown event type' });
    }
  } catch (error: any) {
    console.error('Webhook error', { code: error?.code, message: error?.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
