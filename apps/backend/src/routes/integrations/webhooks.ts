// apps/backend/src/routes/integrations/webhooks.ts
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../../db.js';

const router = Router();

/**
 * IMPORTANT:
 * This route expects req.rawBody to be populated by your JSON body parser verify hook.
 * Example in app.ts/server.ts (before mounting routes):
 *
 * app.use('/integrations/webhooks',
 *   express.json({
 *     verify: (req: any, _res, buf) => { req.rawBody = buf; }
 *   }),
 *   webhooksRouter
 * );
 */

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const WEBHOOK_MAX_SKEW_SEC = Number(process.env.WEBHOOK_MAX_SKEW_SEC || 300);
const WEBHOOK_MAX_BODY_BYTES = Number(process.env.WEBHOOK_MAX_BODY_BYTES || 1_048_576); // 1MB default

type RawBodyRequest = Request & { rawBody?: Buffer };

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

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function getHeader(req: Request, name: string): string {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] || '';
  return typeof v === 'string' ? v : '';
}

function extractSignatures(sigHeaderRaw: string): string[] {
  const raw = String(sigHeaderRaw || '').trim();
  if (!raw) return [];
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);

  const sigs: string[] = [];
  for (const p of parts) {
    // accept sha256=HEX, v1=HEX, or just HEX
    const m = p.match(/^(?:sha256=|v1=)?([0-9a-f]{64})$/i);
    if (m?.[1]) sigs.push(m[1].toLowerCase());
  }

  // also catch cases like "t=...,v1=...."
  if (sigs.length === 0) {
    const re = /(?:sha256=|v1=)?([0-9a-f]{64})/gi;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(raw)) !== null) {
      sigs.push(mm[1].toLowerCase());
    }
  }

  return Array.from(new Set(sigs));
}

function safeEqualHex(aHex: string, bHex: string): boolean {
  try {
    if (!/^[0-9a-f]{64}$/i.test(aHex) || !/^[0-9a-f]{64}$/i.test(bHex)) return false;
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

function verifyWebhookSignature(req: RawBodyRequest, res: Response, next: NextFunction) {
  // Secret must exist (don’t throw—return safe 500)
  if (!WEBHOOK_SECRET) {
    return res.status(500).json({ success: false, error: 'Webhook endpoint not configured' });
  }

  const sigHeader = getHeader(req, 'x-webhook-signature') || getHeader(req, 'x-signature');
  const sigs = extractSignatures(sigHeader);

  if (sigs.length === 0) {
    return res.status(401).json({ success: false, error: 'Missing or invalid signature' });
  }

  const raw = req.rawBody;
  if (!raw || !Buffer.isBuffer(raw) || raw.length === 0) {
    return res.status(500).json({ success: false, error: 'Webhook endpoint not configured' });
  }

  if (raw.length > WEBHOOK_MAX_BODY_BYTES) {
    return res.status(413).json({ success: false, error: 'Payload too large' });
  }

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

    // HMAC(ts + "." + rawBody)
    const signedPayload = Buffer.concat([Buffer.from(`${tsRaw}.`, 'utf8'), raw]);
    const expected = computeHmac(WEBHOOK_SECRET, signedPayload);

    for (const s of sigs) {
      if (safeEqualHex(s, expected)) return next();
    }
    return res.status(401).json({ success: false, error: 'Invalid signature' });
  }

  const expected = computeHmac(WEBHOOK_SECRET, raw);
  for (const s of sigs) {
    if (safeEqualHex(s, expected)) return next();
  }
  return res.status(401).json({ success: false, error: 'Invalid signature' });
}

async function getBranchCode(branchId: string): Promise<string> {
  try {
    const r = await pool.query(`SELECT code FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
    const code = String(r.rows?.[0]?.code || '').trim();
    return code || 'BR';
  } catch {
    return 'BR';
  }
}

function genPaymentNumber(branchCode: string) {
  const d = new Date();
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars
  return `PAY-${branchCode}-${y}${mm}${dd}-${rand}`;
}

function getEventId(req: Request, body: any): string {
  const h =
    getHeader(req, 'x-webhook-id') ||
    getHeader(req, 'x-event-id') ||
    getHeader(req, 'x-request-id');

  const fromHeader = normalizeText(h, 120);
  if (fromHeader) return fromHeader;

  const fromBody =
    normalizeText(body?.event_id, 120) ||
    normalizeText(body?.data?.event_id, 120);

  return fromBody;
}

// POST /integrations/webhooks
router.post('/', verifyWebhookSignature, async (req: RawBodyRequest, res: Response) => {
  try {
    const event_type = normalizeText((req.body as any)?.event_type, 60);
    const branch_id = normalizeText((req.body as any)?.branch_id, 80);
    const data = (req.body as any)?.data;

    const event_id = getEventId(req, req.body);

    if (!event_id) {
      return res.status(400).json({ success: false, error: 'event_id is required (for idempotency)' });
    }
    if (!event_type || !data) {
      return res.status(400).json({ success: false, error: 'Missing event_type or data' });
    }
    if (!branch_id || !isUuid(branch_id)) {
      return res.status(400).json({ success: false, error: 'branch_id must be a UUID' });
    }

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

          // Fast-path dedupe
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

          const invoiceRes = await client.query(
            `SELECT id, branch_id, total_amount, paid_amount, balance, status, due_date
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
          if (String(invoice.status || '').toLowerCase() === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Cannot pay a cancelled invoice' });
          }

          const branchCode = await getBranchCode(branch_id);

          // Insert payment with collision retries (payment_number) + race-safe dedupe (reference_number)
          let paymentNumber: string | null = null;
          let lastGen = genPaymentNumber(branchCode);

          for (let i = 0; i < 3; i++) {
            try {
              await client.query(
                `INSERT INTO payments
                 (branch_id, invoice_id, payment_number, payment_date, paid_at, amount,
                  payment_method, reference_number, notes, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [
                  branch_id,
                  invoice_id,
                  lastGen,
                  toIsoDate(payment_date),
                  payment_date.toISOString(),
                  payment_amount,
                  payment_method,
                  reference_number,
                  `Payment received via webhook (${event_type})`,
                  null,
                ]
              );
              paymentNumber = lastGen;
              break;
            } catch (e: any) {
              // 23505 = unique_violation
              if (e?.code === '23505') {
                // If the unique hit is actually reference_number (concurrent same event), treat as processed
                const ex2 = await client.query(
                  `SELECT id, payment_number
                   FROM payments
                   WHERE branch_id = $1 AND reference_number = $2
                   LIMIT 1`,
                  [branch_id, reference_number]
                );
                if (ex2.rows.length > 0) {
                  await client.query('COMMIT');
                  return res.json({
                    success: true,
                    message: 'Already processed',
                    data: { invoice_id, payment_number: ex2.rows[0].payment_number, reference_number },
                  });
                }

                // Otherwise assume payment_number collision and retry
                lastGen = genPaymentNumber(branchCode);
                continue;
              }
              throw e;
            }
          }

          if (!paymentNumber) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Could not generate unique payment number' });
          }

          const total = Number(invoice.total_amount ?? 0);
          const oldPaid = Number(invoice.paid_amount ?? 0);

          const newPaid = oldPaid + payment_amount;
          const newBalance = Math.max(0, total - newPaid);

          // Schema-safe statuses only
          const today = new Date();
          const dueDate = invoice.due_date ? new Date(String(invoice.due_date)) : null;
          const isOverdue =
            !!dueDate &&
            dueDate.getTime() < new Date(today.toDateString()).getTime() &&
            newBalance > 0.00001;

          const newStatus = newBalance <= 0.00001 ? 'paid' : (isOverdue ? 'overdue' : 'sent');

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
        // If you expect unknown events and don’t want retries, switch to 200 with "ignored".
        return res.status(400).json({ success: false, error: 'Unknown event type' });
    }
  } catch (error: any) {
    console.error('Webhook error', { code: error?.code, message: error?.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
