// apps/backend/src/routes/api/invoices.ts
import { Router, type Response } from 'express';
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool, query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

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

function parseISODate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function num(v: unknown, fallback = 0): number {
  const n = parseNumberStrict(v);
  return n === null ? fallback : n;
}

function money(v: unknown): string {
  return num(v, 0).toFixed(2);
}

function safeText(v: unknown, maxLen = 300): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function escapeHtml(input: unknown): string {
  const s = String(input ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeFilename(v: string, maxLen = 80) {
  const base = (v || 'invoice').replace(/[\r\n]/g, ' ').trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned.slice(0, maxLen) || 'invoice';
}

function fmtDate(d: any): string {
  try {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString();
  } catch {
    return '';
  }
}

function fmtTime(d: any): string {
  try {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function fmtDateTime(d: any): string {
  const dd = fmtDate(d);
  const tt = fmtTime(d);
  if (!dd && !tt) return '';
  if (dd && tt) return `${dd} ${tt}`;
  return dd || tt;
}

// Team lead requirement: GST is 5%
const GST_RATE = 5;

// EZ details (set in .env if you want)
const EZ = {
  name: process.env.EZ_NAME || 'EZ WASTE',
  subtitle: process.env.EZ_SUBTITLE || 'TRANSFER STATION',
  address: process.env.EZ_ADDRESS || '',
  phone: process.env.EZ_PHONE || '',
  email: process.env.EZ_EMAIL || '',
  locationLabel: process.env.EZ_LOCATION_LABEL || '',

  // Branding options
  logoPath: process.env.EZ_LOGO_PATH || '',
  primaryColor: process.env.PDF_PRIMARY_COLOR || '#2E7D32',
  mutedColor: process.env.PDF_MUTED_COLOR || '#6B7280',
  lineColor: process.env.PDF_LINE_COLOR || '#E5E7EB',

  // Watermark options
  watermarkText: process.env.PDF_WATERMARK_TEXT || '',
  watermarkImagePath: process.env.PDF_WATERMARK_IMAGE_PATH || '',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function existingFile(p: string) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveLogoPath(): string | null {
  const candidates: string[] = [];

  if (EZ.logoPath) candidates.push(EZ.logoPath);

  // Common local paths (dev / monorepo)
  candidates.push(path.resolve(process.cwd(), 'apps/backend/assets/logo.png'));
  candidates.push(path.resolve(process.cwd(), 'apps/backend/assets/ez-logo.png'));
  candidates.push(path.resolve(process.cwd(), 'apps/backend/assets/brand-logo.png'));

  // Relative to this file: apps/backend/src/routes/api -> apps/backend/assets
  candidates.push(path.resolve(__dirname, '../../../assets/logo.png'));
  candidates.push(path.resolve(__dirname, '../../../assets/ez-logo.png'));
  candidates.push(path.resolve(__dirname, '../../../assets/brand-logo.png'));

  // Container-style locations
  candidates.push('/app/assets/logo.png');
  candidates.push('/app/assets/ez-logo.png');

  for (const p of candidates) {
    if (existingFile(p)) return p;
  }
  return null;
}

function resolveWatermarkImagePath(): string | null {
  const candidates: string[] = [];
  if (EZ.watermarkImagePath) candidates.push(EZ.watermarkImagePath);

  candidates.push(path.resolve(process.cwd(), 'apps/backend/assets/watermark.png'));
  candidates.push(path.resolve(process.cwd(), 'apps/backend/assets/recycle.png'));
  candidates.push(path.resolve(__dirname, '../../../assets/watermark.png'));
  candidates.push(path.resolve(__dirname, '../../../assets/recycle.png'));
  candidates.push('/app/assets/watermark.png');
  candidates.push('/app/assets/recycle.png');

  for (const p of candidates) {
    if (existingFile(p)) return p;
  }
  return null;
}

// ---- Branch scoping helpers ----
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

/**
 * Shared invoice read:
 * - joins transaction by invoices.transaction_id (new model)
 * - fallback: invoice_line_items.transaction_id (older model)
 * - brings receipt-style metadata from transactions
 *
 * UPDATED (boss): include pricing snapshot fields so receipts can show Qty for item-based pricing.
 */
async function fetchInvoiceWithContext(id: string, branchFilter: string | null) {
  const invoiceResult = await query(
    `
    SELECT
      i.id, i.branch_id, i.client_id, i.invoice_number, i.invoice_date, i.due_date,
      i.subtotal, i.tax_rate, i.tax_amount, i.total_amount, i.paid_amount, i.balance,
      i.payment_terms, i.status,
      i.transaction_id,
      i.created_at,

      -- NEW snapshot fields (boss)
      i.pricing_unit_type,
      i.pricing_quantity,
      i.pricing_unit_price,

      c.company_name, c.contact_person, c.address, c.phone, c.email,

      b.name AS branch_name,
      b.code AS branch_code,
      b.address AS branch_address,
      b.phone AS branch_phone,
      b.email AS branch_email,

      t.id AS tx_id,
      t.transaction_number,
      t.assigned_truck_id,
      t.truck_side_number,
      t.walk_in_name,
      t.material_type,
      t.reference_number,
      t.notes,
      t.first_weight,
      t.first_weight_time,
      t.second_weight,
      t.second_weight_time,
      t.net_weight

    FROM invoices i
    LEFT JOIN clients c ON i.client_id = c.id
    LEFT JOIN branches b ON b.id = i.branch_id

    LEFT JOIN LATERAL (
      SELECT li.transaction_id
      FROM invoice_line_items li
      WHERE li.invoice_id = i.id AND li.transaction_id IS NOT NULL
      ORDER BY li.id ASC
      LIMIT 1
    ) li_tx ON true

    LEFT JOIN transactions t ON t.id = COALESCE(i.transaction_id, li_tx.transaction_id)

    WHERE i.id = $1
      AND ($2::uuid IS NULL OR i.branch_id = $2)
    LIMIT 1
    `,
    [id, branchFilter]
  );

  return invoiceResult;
}

/**
 * PATCH /api/invoices/:id/cancel
 * FIXED (Bug #2):
 * - transaction invoices: reverse BOTH clients + customers balances
 * - monthly invoices: revert billing_charges to unbilled (NO balance changes)
 */
router.patch('/:id/cancel', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilterForRead(req, res);
  if (branchFilter === undefined) return;

  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  const reason = normalizeText((req.body ?? {})?.reason ?? (req.body ?? {})?.notes, 500);

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const invRes = await db.query(
      `
      SELECT *
      FROM invoices
      WHERE id = $1
        AND ($2::uuid IS NULL OR branch_id = $2)
      FOR UPDATE
      `,
      [id, branchFilter]
    );

    if (invRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return notFound(res, 'Invoice not found');
    }

    const inv = invRes.rows[0];
    const status = String(inv.status || '').toLowerCase();
    const invoiceType = String(inv.invoice_type || 'transaction').toLowerCase(); // 'transaction' | 'monthly'
    const invoiceBranchId = String(inv.branch_id || '');

    if (status === 'cancelled') {
      await db.query('COMMIT');
      return res.json({ success: true, data: inv, meta: { existing: true } });
    }

    if (status === 'paid') {
      await db.query('ROLLBACK');
      return badRequest(res, 'Cannot cancel a paid invoice');
    }

    const paidAmount = Number(inv.paid_amount ?? 0);
    if (Number.isFinite(paidAmount) && paidAmount > 0.00001) {
      await db.query('ROLLBACK');
      return badRequest(res, 'Cannot cancel: invoice has paid_amount > 0');
    }

    const payExists = await db.query(`SELECT 1 FROM payments WHERE invoice_id = $1 LIMIT 1`, [id]);
    if (payExists.rows.length > 0) {
      await db.query('ROLLBACK');
      return badRequest(res, 'Cannot cancel: payment records exist for this invoice');
    }

    if (status !== 'draft' && status !== 'sent' && status !== 'overdue') {
      await db.query('ROLLBACK');
      return badRequest(res, `Cannot cancel invoice with status '${status}'`);
    }

    const outstanding = Math.max(0, Number(inv.balance ?? inv.total_amount ?? 0));

    if (invoiceType === 'monthly') {
      await db.query(
        `
        UPDATE billing_charges
        SET status = 'unbilled',
            billed_invoice_id = NULL,
            updated_at = NOW()
        WHERE billed_invoice_id = $1
        `,
        [id]
      );
    } else {
      const clientId = inv.client_id ? String(inv.client_id) : '';
      const customerId = inv.customer_id ? String(inv.customer_id) : '';

      if (outstanding > 0.00001) {
        if (clientId && isUuid(clientId) && invoiceBranchId && isUuid(invoiceBranchId)) {
          await db.query(
            `
            UPDATE clients
            SET current_balance = GREATEST(0, COALESCE(current_balance, 0) - $1),
                updated_at = NOW()
            WHERE id = $2 AND branch_id = $3
            `,
            [outstanding, clientId, invoiceBranchId]
          );
        }

        if (customerId && isUuid(customerId)) {
          await db.query(
            `
            UPDATE customers
            SET current_balance = GREATEST(0, COALESCE(current_balance, 0) - $1),
                updated_at = NOW()
            WHERE id = $2
            `,
            [outstanding, customerId]
          );
        }
      }
    }

    const stamp = new Date().toISOString();
    const extraNote = reason ? `\n[Cancelled ${stamp}] ${reason}` : `\n[Cancelled ${stamp}]`;

    const upd = await db.query(
      `
      UPDATE invoices
      SET
        status = 'cancelled',
        balance = 0,
        notes = COALESCE(notes,'') || $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [extraNote, id]
    );

    await db.query('COMMIT');
    return res.json({ success: true, data: upd.rows[0] });
  } catch (error: any) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('Cancel invoice error', { code: error?.code, message: error?.message });
    return serverError(res);
  } finally {
    db.release();
  }
});

/**
 * GET /api/invoices
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilterForRead(req, res);
  if (branchFilter === undefined) return;

  const limitRaw = parseIntStrict(req.query.limit);
  const offsetRaw = parseIntStrict(req.query.offset);

  const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 200) : 100;
  const offset = offsetRaw !== null ? Math.max(offsetRaw, 0) : 0;

  try {
    const result = await query(
      `
      SELECT
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.status,
        i.total_amount,
        i.paid_amount,
        i.balance,
        i.created_at,

        COALESCE(c.company_name, NULLIF(t.walk_in_name, ''), 'WALK-IN') AS company_name,

        t.assigned_truck_id,
        t.truck_side_number,
        t.transaction_number

      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id

      LEFT JOIN LATERAL (
        SELECT li.transaction_id
        FROM invoice_line_items li
        WHERE li.invoice_id = i.id AND li.transaction_id IS NOT NULL
        ORDER BY li.id ASC
        LIMIT 1
      ) li_tx ON true

      LEFT JOIN transactions t ON t.id = COALESCE(i.transaction_id, li_tx.transaction_id)

      WHERE ($1::uuid IS NULL OR i.branch_id = $1)
      ORDER BY i.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [branchFilter, limit, offset]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Get invoices error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

// ---- PDF helpers ----
function drawKeyValue(doc: PdfDoc, label: string, value: string) {
  doc.fontSize(10).fillColor('#444').text(label, { continued: true });
  doc.fillColor('#000').text(` ${value}`);
}

function drawSectionTitle(doc: PdfDoc, title: string) {
  doc.moveDown(0.6);
  doc.fontSize(12).fillColor('#000').text(title, { underline: true });
  doc.moveDown(0.3);
}

function drawChargesHeader(doc: PdfDoc, startX: number, pageWidth: number) {
  const colDesc = startX;
  const colAmt = startX + pageWidth * 0.82;

  const y = doc.y;
  doc.fontSize(10).fillColor('#000');
  doc.text('Description', colDesc, y, { width: pageWidth * 0.8 });
  doc.text('Amount', colAmt, y, { width: pageWidth * 0.18, align: 'right' });

  doc.moveDown(0.4);
  doc.strokeColor('#000');
  doc.moveTo(startX, doc.y).lineTo(startX + pageWidth, doc.y).stroke();
  doc.moveDown(0.4);

  return { colDesc, colAmt };
}

type BrandOpts = {
  docNo?: string;
  docLabel?: string;
  rightLines?: string[];
};

function drawBrandedHeader(doc: PdfDoc, opts: BrandOpts = {}) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const top = doc.page.margins.top;

  const pageWidth = right - left;

  // ---- Watermark (each page) ----
  const wmText = (EZ.watermarkText || `${EZ.name} ${EZ.subtitle}`.trim()).trim();
  const wmImg = resolveWatermarkImagePath();

  doc.save();
  try {
    if (wmImg) {
      doc.opacity(0.06);
      const w = Math.min(420, pageWidth);
      const x = left + (pageWidth - w) / 2;
      const y = doc.page.height * 0.52 - w * 0.35;
      doc.image(wmImg, x, y, { width: w });
    }

    if (wmText) {
      doc.opacity(0.06);
      doc.fillColor(EZ.primaryColor);
      doc.fontSize(64);
      const cx = doc.page.width / 2;
      const cy = doc.page.height / 2;

      doc.rotate(-18, { origin: [cx, cy] });
      doc.text(wmText, left, cy - 40, { width: pageWidth, align: 'center' });
      doc.rotate(18, { origin: [cx, cy] });
    }
  } catch {
    // ignore watermark errors
  } finally {
    doc.restore();
  }

  // ---- Header block ----
  const headerY = top - 10;
  const logoSize = 56;
  const gap = 12;
  const headerHeight = 92;

  const logoPath = resolveLogoPath();

  doc.save();
  try {
    doc.strokeColor(EZ.lineColor);
    doc.lineWidth(1);

    if (logoPath) {
      try {
        doc.image(logoPath, left, headerY, { width: logoSize, height: logoSize });
      } catch {}
    }

    const titleX = left + (logoPath ? logoSize + gap : 0);
    const titleTop = headerY;

    doc.fillColor(EZ.primaryColor).fontSize(26).text(String(EZ.name || 'EZ').trim(), titleX, titleTop, {
      width: pageWidth * 0.62,
    });

    doc.fillColor(EZ.primaryColor).fontSize(13).text(String(EZ.subtitle || '').trim(), titleX, titleTop + 30, {
      width: pageWidth * 0.62,
    });

    doc.fillColor(EZ.mutedColor).fontSize(10);
    const infoLines: string[] = [];
    if (EZ.address) infoLines.push(String(EZ.address));
    if (EZ.phone) infoLines.push(`Ph: ${EZ.phone}`);
    if (EZ.email) infoLines.push(`Email: ${EZ.email}`);
    if (infoLines.length) {
      doc.text(infoLines.join('\n'), titleX, titleTop + 48, { width: pageWidth * 0.62 });
    }

    if (EZ.locationLabel) {
      const pillText = String(EZ.locationLabel).trim();
      const pillPaddingX = 10;
      const pillH = 18;

      doc.fontSize(10);
      const pillW = Math.min(pageWidth * 0.4, doc.widthOfString(pillText) + pillPaddingX * 2);
      const pillX = titleX;
      const pillY = titleTop + 82;

      doc.roundedRect(pillX, pillY, pillW, pillH, 9).fill(EZ.primaryColor);
      doc.fillColor('#FFFFFF').text(pillText, pillX + pillPaddingX, pillY + 4, { width: pillW - pillPaddingX * 2 });
    }

    const metaW = Math.min(180, pageWidth * 0.3);
    const metaX = right - metaW;

    const docNo = String(opts.docNo || '').trim();
    const docLabel = String(opts.docLabel || '').trim();
    const rightLines = Array.isArray(opts.rightLines) ? opts.rightLines.filter(Boolean).map(String) : [];

    if (docNo) {
      doc.fillColor(EZ.primaryColor).fontSize(20).text(docNo, metaX, titleTop, { width: metaW, align: 'right' });
    }
    if (docLabel || rightLines.length) {
      doc.fillColor(EZ.mutedColor).fontSize(10);
      const lines = [docLabel, ...rightLines].filter(Boolean).join('\n');
      if (lines) doc.text(lines, metaX, titleTop + 26, { width: metaW, align: 'right' });
    }

    const lineY = headerY + headerHeight;
    doc.moveTo(left, lineY).lineTo(right, lineY).stroke();
  } finally {
    doc.restore();
  }

  doc.x = left;
  doc.y = headerY + headerHeight + 10;

  doc.fillColor('#000');
  doc.strokeColor('#000');
}

function installBranding(doc: PdfDoc, opts: BrandOpts) {
  drawBrandedHeader(doc, opts);
  doc.on('pageAdded', () => {
    drawBrandedHeader(doc, opts);
  });
}

// =====================
// RECEIPT (Thermal/POS) helpers — matches EZ WASTE sample layout
// =====================

const RECEIPT_GREEN = process.env.EZ_GREEN || '#2E8B57';
const RECEIPT_RED = '#C62828';
const RECEIPT_GRAY = '#6B7280';

function mmToPt(mm: number) {
  return (mm * 72) / 25.4;
}
function ptToMm(pt: number) {
  return (pt * 25.4) / 72;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function getReceiptSafeInsetPt() {
  const mm = Number(process.env.PDF_RECEIPT_SAFE_INSET_MM || 2);
  return mmToPt(clamp(mm, 0, 5));
}

function parseFloatStrict(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Receipt size MUST match printer paper width to avoid "blank / cropped" prints.
 *
 * Supports runtime overrides:
 *   /api/invoices/:id/pdf?paper_mm=72
 *   /api/invoices/:id/pdf?width_mm=72&height_mm=160&margin_mm=2
 *
 * UPDATED:
 * - default height reduced (240mm -> 170mm)
 * - supports PDF_RECEIPT_HEIGHT_MM=auto
 * - supports suggestedHeightMm (auto estimate from route)
 */
function getReceiptPageSizeFromReq(req?: AuthRequest, suggestedHeightMm?: number) {
  const q: any = (req as any)?.query ?? {};

  // your printer: 72mm (keep as default)
  const envWidth = Number(process.env.PDF_RECEIPT_WIDTH_MM || 72);

  // allow env "auto"
  const envHeightRaw = String(process.env.PDF_RECEIPT_HEIGHT_MM || '170').trim();
  const envHeight = envHeightRaw.toLowerCase() === 'auto' ? NaN : Number(envHeightRaw || 170);

  const envMargin = Number(process.env.PDF_RECEIPT_MARGIN_MM || 0);

  const widthMmIn =
    parseFloatStrict(q.paper_mm) ??
    parseFloatStrict(q.width_mm) ??
    (Number.isFinite(envWidth) ? envWidth : 72);

  const suggestedH = Number(suggestedHeightMm);
  const heightMmIn =
    parseFloatStrict(q.height_mm) ??
    (Number.isFinite(suggestedH) ? suggestedH : Number.isFinite(envHeight) ? envHeight : 170);

  const marginMmIn = parseFloatStrict(q.margin_mm) ?? (Number.isFinite(envMargin) ? envMargin : 0);

  const widthMm = clamp(widthMmIn, 48, 90);
  const heightMm = clamp(heightMmIn, 80, 500);
  const marginMm = clamp(marginMmIn, 0, 8);

  const heightPtRaw = Number(process.env.PDF_RECEIPT_HEIGHT_PT || 0);

  const widthPt = mmToPt(widthMm);
  const heightPt = Number.isFinite(heightPtRaw) && heightPtRaw > 300 ? heightPtRaw : mmToPt(heightMm);
  const marginPt = mmToPt(marginMm);

  return { widthMm, heightMm, marginMm, widthPt, heightPt, marginPt };
}

function resolveOptionalImage(p: string | undefined | null): string | null {
  const s = String(p || '').trim();
  if (!s) return null;

  const abs = path.isAbsolute(s) ? s : path.resolve(process.cwd(), s);
  try {
    if (fs.existsSync(abs)) return abs;
  } catch {}
  return null;
}

// Use en-GB to match: 21/12/2025
function fmtDateReceipt(d: any): string {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-GB');
  } catch {
    return '';
  }
}
function fmtTimeReceipt(d: any): string {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return '';
  }
}
function fmtDateTimeReceipt(d: any): string {
  const t = fmtTimeReceipt(d);
  const da = fmtDateReceipt(d);
  return [t, da].filter(Boolean).join(' ');
}

/**
 * Keep modern yearly receipt numbers exactly as stored:
 *   2026-00001
 *   2027-00001
 *
 * For anything else, return the original trimmed string.
 */
function formatReceiptNumber(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';

  if (/^\d{4}-\d{5}$/.test(s)) return s;

  return s;
}

function splitAddressLines(addrRaw: string): string[] {
  const addr = String(addrRaw || '').trim();
  if (!addr) return [];
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [addr];

  const oneLine = parts.join(', ');
  if (oneLine.length <= 42) return [oneLine];

  const a = parts.slice(0, 2).join(', ');
  const b = parts.slice(2).join(', ');
  return [a, b].filter(Boolean);
}

function resolveReceiptWatermarkPath(): string | null {
  return resolveOptionalImage(process.env.EZ_RECYCLE_WATERMARK_PATH) || resolveWatermarkImagePath();
}

/**
 * Draw recycle watermark WITHOUT changing doc.x/doc.y (important!)
 */
function drawReceiptWatermark(doc: PdfDoc, pageW: number, pageH: number, bodyTopY: number) {
  const prevX = doc.x;
  const prevY = doc.y;

  const wm = resolveReceiptWatermarkPath();

  doc.save();
  try {
    doc.opacity(0.1);

    if (wm) {
      const wmW = pageW * 0.78;
      const x = (pageW - wmW) / 2;
      const y = Math.min(pageH * 0.33, bodyTopY + 65);
      doc.image(wm, x, y, { width: wmW });
    } else {
      doc.font('Helvetica-Bold').fontSize(26).fillColor('#777');
      doc.text('EZ WASTE MANAGEMENT', 0, Math.min(pageH * 0.4, bodyTopY + 80), { align: 'center' });
    }
  } catch {
    // ignore
  } finally {
    doc.restore();
    doc.x = prevX;
    doc.y = prevY;
  }
}

type ReceiptTopOpts = {
  ticketNo: string;
  locationLabel: string;
};

function drawReceiptTopBlock(doc: PdfDoc, pageW: number, opts: ReceiptTopOpts) {
  const safeInset = getReceiptSafeInsetPt();

  const marginX = doc.page.margins.left + safeInset;
  const contentW = pageW - doc.page.margins.left - doc.page.margins.right - safeInset * 2;

  let y = doc.page.margins.top + safeInset + 1;

  // Ticket number (top center) — kept inside printable area
  doc.save();
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(RECEIPT_RED)
    .text(opts.ticketNo || '', marginX, y, { width: contentW, align: 'center' });
  doc.restore();

  y += 14;

  // "EZ WASTE" centered, with EZ in green and WASTE in black
  doc.font('Helvetica-Bold').fontSize(26);

  const wEZ = doc.widthOfString('EZ');
  const wWaste = doc.widthOfString('WASTE');
  const gap = 6;
  const total = wEZ + gap + wWaste;
  const xStart = marginX + (contentW - total) / 2;

  doc.fillColor(RECEIPT_GREEN).text('EZ', xStart, y, { lineBreak: false });
  doc.fillColor('#111').text('WASTE', xStart + wEZ + gap, y, { lineBreak: false });

  y += 30;
  doc.x = marginX;
  doc.y = y;

  // Green bar: TRANSFER STATION
  const barH = 18;
  doc.save();
  doc.rect(marginX, y, contentW, barH).fill(RECEIPT_GREEN);
  doc
    .fillColor('#fff')
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('TRANSFER STATION', marginX, y + 4, { width: contentW, align: 'center' });
  doc.restore();

  y += barH + 6;

  // Address
  const addrLines = splitAddressLines(String(EZ.address || process.env.EZ_ADDRESS || '2411-76 Ave NW, Edmonton, AB T6P 1P6'));
  if (addrLines.length) {
    doc.font('Helvetica').fontSize(8.4).fillColor('#111');
    for (const line of addrLines) {
      doc.text(line, marginX, y, { width: contentW, align: 'center' });
      y = doc.y;
    }
  }

  // Phone
  const phone = String(EZ.phone || process.env.EZ_PHONE || '780-915-1998').trim();
  if (phone) {
    doc.fillColor(RECEIPT_GREEN).font('Helvetica-Bold').fontSize(9.2);
    doc.text(`Ph: ${phone}`, marginX, y, { width: contentW, align: 'center' });
    y = doc.y;
  }

  // Email
  const email = String(EZ.email || process.env.EZ_EMAIL || 'customersupport@ezwm.ca').trim();
  if (email) {
    doc.fillColor('#111').font('Helvetica').fontSize(8.1);
    doc.text(`Email: ${email}`, marginX, y, { width: contentW, align: 'center' });
    y = doc.y;
  }

  y += 6;

  // Location pill
  const pillText = (opts.locationLabel || 'SOUTHSIDE LOCATION').toUpperCase();
  const pillW = contentW * 0.78;
  const pillH = 18;
  const pillX = marginX + (contentW - pillW) / 2;

  doc.save();
  doc.roundedRect(pillX, y, pillW, pillH, 9).fill(RECEIPT_GREEN);
  doc
    .fillColor('#fff')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(pillText, pillX, y + 4, { width: pillW, align: 'center' });
  doc.restore();

  y += pillH + 8;

  // Faint watermark text
  doc.save();
  doc.opacity(0.35);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#999');
  doc.text('EZ WASTE MANAGEMENT', marginX, y, { width: contentW, align: 'center' });
  doc.restore();

  y += 18;

  doc.x = marginX;
  doc.y = y;

  return y;
}

function drawReceiptCenteredLine(doc: PdfDoc, pageW: number, text: string, y: number, color = '#111', size = 9) {
  const safeInset = getReceiptSafeInsetPt();
  const marginX = doc.page.margins.left + safeInset;
  const contentW = pageW - doc.page.margins.left - doc.page.margins.right - safeInset * 2;

  doc.font('Helvetica').fontSize(size).fillColor(color);
  doc.text(text, marginX, y, { width: contentW, align: 'center' });

  return doc.y;
}

function drawLineField(doc: PdfDoc, label: string, value?: string) {
  const safeInset = getReceiptSafeInsetPt();
  const x = doc.page.margins.left + safeInset;
  const right = doc.page.width - doc.page.margins.right - safeInset;
  const y = doc.y;

  doc.font('Helvetica').fontSize(9).fillColor('#111').text(label, x, y, { lineBreak: false });

  const labelW = doc.widthOfString(label) + 6;
  const lineX1 = x + labelW;
  const lineY = y + 11;

  if (value) {
    doc.font('Helvetica').fontSize(9).fillColor('#111').text(value, lineX1 + 2, y, {
      width: right - (lineX1 + 2),
      ellipsis: true,
    });
  }

  doc.moveTo(lineX1, lineY).lineTo(right, lineY).strokeColor('#111').lineWidth(0.7).stroke();
  doc.moveDown(1.1);
}

/**
 * Truck ID source selector (side_first by default)
 * Env:
 *   RECEIPT_TRUCK_ID_SOURCE=side_first | assigned_first
 */
function resolveReceiptTruckId(row: any): string {
  const side = safeText(row?.truck_side_number, 60);
  const assigned = String(row?.assigned_truck_id ?? '').trim();

  const mode = String(process.env.RECEIPT_TRUCK_ID_SOURCE || 'side_first').toLowerCase();
  if (mode === 'assigned_first') return assigned || side || '';
  return side || assigned || '';
}

/**
 * Rich weighing/calculation block (keeps your colored receipt, only improves the middle numbers)
 */
function drawReceiptWeighingInfoBlock(doc: PdfDoc, pageW: number, row: any, startY: number) {
  let y = startY;

  const truckId = resolveReceiptTruckId(row);

  const inboundAt = row.first_weight_time || row.created_at || row.invoice_date;
  const outboundAt = row.second_weight_time || row.created_at || row.invoice_date;

  const w1 = num(row.first_weight, NaN);
  const w2 = num(row.second_weight, NaN);

  const inboundWeight = Number.isFinite(w1) ? w1 : Number.isFinite(w2) ? w2 : num(row.net_weight, 0);
  const hasOutbound = !!row.second_weight_time || (Number.isFinite(w2) && w2 > 0);

  // Inbound
  const inTs = fmtDateTimeReceipt(inboundAt);
  if (inTs) y = drawReceiptCenteredLine(doc, pageW, inTs, y, RECEIPT_GRAY, 8.8);

  if (truckId) y = drawReceiptCenteredLine(doc, pageW, `Inbound Truck ID: ${truckId}`, y, RECEIPT_GRAY, 8.8);

  if (Number.isFinite(inboundWeight) && inboundWeight > 0) {
    y = drawReceiptCenteredLine(doc, pageW, `Scale Weight ${Math.round(inboundWeight)} kg`, y, RECEIPT_GRAY, 8.8);
  }

  // Outbound + gross/tare
  let gross = NaN;
  let tare = NaN;

  if (hasOutbound) {
    y += 10;

    const outTs = fmtDateTimeReceipt(outboundAt);
    if (outTs) y = drawReceiptCenteredLine(doc, pageW, outTs, y, RECEIPT_GRAY, 8.8);

    if (truckId) y = drawReceiptCenteredLine(doc, pageW, `Outbound Truck ID: ${truckId}`, y, RECEIPT_GRAY, 8.8);

    const outboundWeight = Number.isFinite(w2) ? w2 : inboundWeight;
    gross = Math.max(inboundWeight, outboundWeight);
    tare = Math.min(inboundWeight, outboundWeight);

    y += 8;
    if (Number.isFinite(gross)) y = drawReceiptCenteredLine(doc, pageW, `Gross ${Math.round(gross)} kg`, y, RECEIPT_GRAY, 8.8);
    if (Number.isFinite(tare)) y = drawReceiptCenteredLine(doc, pageW, `Tare ${Math.round(tare)} kg`, y, RECEIPT_GRAY, 8.8);
  }

  // Net (prefer DB)
  let net = num(row.net_weight, NaN);
  if (!Number.isFinite(net) || net < 0) {
    if (Number.isFinite(gross) && Number.isFinite(tare)) net = Math.max(0, gross - tare);
  }

  return { y, net };
}

/**
 * AUTO height estimation (to avoid long blank receipts)
 */
function estimateReceiptHeightMm(row: any) {
  const addrLines = splitAddressLines(
    String(EZ.address || process.env.EZ_ADDRESS || '2411-76 Ave NW, Edmonton, AB T6P 1P6')
  );

  const headerPtsBase = 137;
  const headerPts = headerPtsBase + addrLines.length * 10;

  const truckId = resolveReceiptTruckId(row);

  const inboundAt = row.first_weight_time || row.created_at || row.invoice_date;
  const outboundAt = row.second_weight_time || row.created_at || row.invoice_date;

  const w1 = num(row.first_weight, NaN);
  const w2 = num(row.second_weight, NaN);

  const inboundWeight = Number.isFinite(w1) ? w1 : Number.isFinite(w2) ? w2 : num(row.net_weight, 0);
  const hasOutbound = !!row.second_weight_time || (Number.isFinite(w2) && w2 > 0);

  let weighPts = 0;

  if (fmtDateTimeReceipt(inboundAt)) weighPts += 10;
  if (truckId) weighPts += 10;
  if (Number.isFinite(inboundWeight) && inboundWeight > 0) weighPts += 10;

  if (hasOutbound) {
    weighPts += 10;
    if (fmtDateTimeReceipt(outboundAt)) weighPts += 10;
    if (truckId) weighPts += 10;
    weighPts += 8;
    weighPts += 20;
  }

  const afterPts = 97;

  const contentPts = headerPts + weighPts + afterPts;
  const contentMm = ptToMm(contentPts);

  const safeExtraMm = 12;

  return clamp(contentMm + safeExtraMm, 90, 260);
}

/**
 * OPTIONAL: simple/plain receipt style (only used when explicitly requested with ?style=simple)
 */
function drawSimpleWeighingReceipt(doc: PdfDoc, pageW: number, row: any) {
  const safeInset = getReceiptSafeInsetPt();
  const left = doc.page.margins.left + safeInset;
  const contentW = pageW - doc.page.margins.left - doc.page.margins.right - safeInset * 2;

  const truckId = resolveReceiptTruckId(row);
  const w1 = num(row.first_weight, NaN);
  const w2 = num(row.second_weight, NaN);
  const hasBoth = Number.isFinite(w1) && w1 > 0 && Number.isFinite(w2) && w2 > 0;
  const gross = hasBoth ? Math.max(w1, w2) : Number.isFinite(w1) ? w1 : Number.isFinite(w2) ? w2 : num(row.net_weight, 0);
  const tare = hasBoth ? Math.min(w1, w2) : 0;

  let net = num(row.net_weight, NaN);
  if (!Number.isFinite(net) || net < 0) {
    net = Math.max(0, gross - tare);
  }

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111');
  doc.text('WEIGHING RECEIPT', left, doc.y, { width: contentW, align: 'left' });
  doc.moveDown(0.6);

  doc.font('Helvetica').fontSize(10).fillColor('#111');
  if (truckId) doc.text(`Inbound Truck ID: ${truckId}`, left, doc.y, { width: contentW, align: 'left' });
  doc.text(`Gross ${Math.round(gross)} kg`, left, doc.y, { width: contentW, align: 'left' });
  doc.text(`Tare ${Math.round(tare)} kg`, left, doc.y, { width: contentW, align: 'left' });

  doc.moveDown(0.6);

  doc.save();
  doc.strokeColor('#111').lineWidth(0.7);
  doc.moveTo(left, doc.y).lineTo(left + contentW, doc.y).stroke();
  doc.restore();

  doc.moveDown(0.6);

  doc.font('Helvetica').fontSize(11).fillColor('#111');
  doc.text(`Net ${Math.round(net)} kg`, left, doc.y, { width: contentW, align: 'left' });
  doc.moveDown(0.6);
}

// =====================
// FIXED (Bug #1):
// /statement/pdf MUST be declared BEFORE /:id/pdf
// =====================

/**
 * UPDATED (boss): Statement (cut-off) invoice PDF shows Net/Qty + Unit price + Total price
 * GET /api/invoices/statement/pdf?client_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get('/statement/pdf', requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilterForRead(req, res);
  if (branchFilter === undefined) return;

  const clientId = String(req.query.client_id || '').trim();
  if (!isUuid(clientId)) return badRequest(res, 'client_id must be a UUID');

  const from = parseISODate(req.query.from);
  const to = parseISODate(req.query.to);
  if (!from || !to) return badRequest(res, 'from and to are required (YYYY-MM-DD)');

  if (branchFilter) {
    const c = await query(`SELECT 1 FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [clientId, branchFilter]);
    if (c.rows.length === 0) return forbidden(res, 'Client not found in your branch context');
  }

  try {
    const clientRes = await query(
      `
      SELECT company_name, contact_person, address, phone, email
      FROM clients
      WHERE id = $1
      LIMIT 1
      `,
      [clientId]
    );
    if (clientRes.rows.length === 0) return notFound(res, 'Client not found');

    const clientRow = clientRes.rows[0];

    const rowsRes = await query(
      `
      SELECT
        i.id AS invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.subtotal,

        -- snapshot fields (preferred)
        i.pricing_unit_type,
        i.pricing_quantity,
        i.pricing_unit_price,

        b.name AS branch_name,
        b.code AS branch_code,

        t.transaction_number,
        t.assigned_truck_id,
        t.truck_side_number,
        t.net_weight,
        t.second_weight_time,

        -- optional fallback fields (older model)
        li_first.quantity AS li_quantity,
        li_first.unit_price AS li_unit_price,
        li_first.amount AS li_amount

      FROM invoices i
      JOIN branches b ON b.id = i.branch_id

      LEFT JOIN LATERAL (
        SELECT li2.transaction_id
        FROM invoice_line_items li2
        WHERE li2.invoice_id = i.id AND li2.transaction_id IS NOT NULL
        ORDER BY li2.id ASC
        LIMIT 1
      ) li_tx ON true

      LEFT JOIN LATERAL (
        SELECT li3.quantity, li3.unit_price, li3.amount
        FROM invoice_line_items li3
        WHERE li3.invoice_id = i.id
        ORDER BY li3.id ASC
        LIMIT 1
      ) li_first ON true

      LEFT JOIN transactions t ON t.id = COALESCE(i.transaction_id, li_tx.transaction_id)

      WHERE i.client_id = $1
        AND i.status <> 'cancelled'
        AND ($2::uuid IS NULL OR i.branch_id = $2)
        AND COALESCE(t.second_weight_time, i.created_at) >= $3::date
        AND COALESCE(t.second_weight_time, i.created_at) < ($4::date + INTERVAL '1 day')
      ORDER BY COALESCE(t.second_weight_time, i.created_at) ASC, i.invoice_number ASC
      `,
      [clientId, branchFilter, from, to]
    );

    const items = rowsRes.rows as any[];
    if (items.length === 0) {
      return badRequest(res, 'No transactions/invoices found for this client in the selected period');
    }

    const periodLabel = `${from} to ${to}`;
    const filename = sanitizeFilename(`invoice-${safeText(clientRow.company_name, 50) || 'client'}-${from}-to-${to}`) + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    installBranding(doc as any, { docNo: 'STATEMENT', docLabel: 'Period', rightLines: [periodLabel] });

    doc.fontSize(18).fillColor('#000').text('INVOICE STATEMENT', { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(11).fillColor('#333').text(`Cut-off Period: ${periodLabel}`, { align: 'center' });
    doc.moveDown(0.8);

    drawSectionTitle(doc as any, 'Customer');
    doc.fontSize(12).fillColor('#000').text(safeText(clientRow.company_name, 200) || '—');
    doc.fontSize(10).fillColor('#333');

    const cp = safeText(clientRow.contact_person, 200);
    if (cp) doc.text(cp);

    const ca = safeText(clientRow.address, 300);
    if (ca) doc.text(ca);

    const cph = safeText(clientRow.phone, 120);
    if (cph) doc.text(`Phone: ${cph}`);

    const ce = safeText(clientRow.email, 160);
    if (ce) doc.text(`Email: ${ce}`);

    drawSectionTitle(doc as any, 'Transactions');

    const startX = doc.x;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const colDate = startX;
    const colTime = startX + pageWidth * 0.14;
    const colBranch = startX + pageWidth * 0.26;
    const colTruck = startX + pageWidth * 0.5;
    const colNetQty = startX + pageWidth * 0.66;
    const colUnitPrice = startX + pageWidth * 0.78;
    const colTotal = startX + pageWidth * 0.9;

    const drawStatementHeader = () => {
      const y = doc.y;
      doc.fontSize(9).fillColor('#000');
      doc.text('Date', colDate, y, { width: pageWidth * 0.13 });
      doc.text('Time', colTime, y, { width: pageWidth * 0.1 });
      doc.text('Branch', colBranch, y, { width: pageWidth * 0.23 });
      doc.text('Truck ID', colTruck, y, { width: pageWidth * 0.15 });
      doc.text('Net/Q', colNetQty, y, { width: pageWidth * 0.11, align: 'right' });
      doc.text('Unit price', colUnitPrice, y, { width: pageWidth * 0.12, align: 'right' });
      doc.text('Total', colTotal, y, { width: pageWidth * 0.1, align: 'right' });
      doc.moveDown(0.3);
      doc.strokeColor('#000');
      doc.moveTo(startX, doc.y).lineTo(startX + pageWidth, doc.y).stroke();
      doc.moveDown(0.4);
    };

    drawStatementHeader();

    let grandSubtotal = 0;

    for (const r of items) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 90) {
        doc.addPage();
        drawStatementHeader();
      }

      const dt = r.second_weight_time || r.invoice_date;
      const dateStr = fmtDate(dt) || '';
      const timeStr = fmtTime(dt) || '';

      const branchStr = safeText(r.branch_name, 120) || safeText(r.branch_code, 20) || '';
      const truckId = (safeText(r.truck_side_number, 40) || String(r.assigned_truck_id ?? '') || '').trim();

      const unitType = String(r.pricing_unit_type || '').toLowerCase();

      const qtySnap = num(r.pricing_quantity, 0);
      const qtyFallback = num(r.li_quantity, 0);
      const qty = qtySnap > 0 ? qtySnap : qtyFallback;

      const net = num(r.net_weight, 0);
      const netOrQty = unitType === 'item' && qty > 0 ? `${Math.round(qty)}` : net.toFixed(2);

      let unitPrice = num(r.pricing_unit_price, NaN);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        const liUp = num(r.li_unit_price, NaN);
        if (Number.isFinite(liUp) && liUp > 0) unitPrice = liUp;
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        if (qty > 0) unitPrice = num(r.subtotal, 0) / qty;
      }
      if (!Number.isFinite(unitPrice)) unitPrice = 0;

      const lineTotal = num(r.subtotal, 0);
      grandSubtotal += lineTotal;

      doc.fontSize(9).fillColor('#000');
      doc.text(dateStr, colDate, doc.y, { width: pageWidth * 0.13 });
      doc.text(timeStr, colTime, doc.y, { width: pageWidth * 0.1 });
      doc.text(branchStr, colBranch, doc.y, { width: pageWidth * 0.23 });
      doc.text(truckId, colTruck, doc.y, { width: pageWidth * 0.15 });
      doc.text(netOrQty, colNetQty, doc.y, { width: pageWidth * 0.11, align: 'right' });
      doc.text(unitPrice.toFixed(2), colUnitPrice, doc.y, { width: pageWidth * 0.12, align: 'right' });
      doc.text(lineTotal.toFixed(2), colTotal, doc.y, { width: pageWidth * 0.1, align: 'right' });
      doc.moveDown(0.8);
    }

    const taxAmount = Math.round((grandSubtotal * (GST_RATE / 100) + Number.EPSILON) * 100) / 100;
    const grandTotal = Math.round((grandSubtotal + taxAmount + Number.EPSILON) * 100) / 100;

    doc.moveDown(0.6);
    doc.strokeColor('#000');
    doc.moveTo(startX + pageWidth * 0.55, doc.y).lineTo(startX + pageWidth, doc.y).stroke();
    doc.moveDown(0.4);

    const rightX = startX + pageWidth * 0.55;
    doc.fontSize(11).fillColor('#000');
    doc.text(`Grand Total: ${grandSubtotal.toFixed(2)}`, rightX, doc.y, { align: 'right' });
    doc.text(`GST (${GST_RATE}%): ${taxAmount.toFixed(2)}`, rightX, doc.y, { align: 'right' });
    doc.fontSize(12).text(`Total Due: ${grandTotal.toFixed(2)}`, rightX, doc.y, { align: 'right' });

    doc.end();
  } catch (error: any) {
    console.error('Statement invoice PDF error', { code: error?.code, message: error?.message });
    if (!res.headersSent) return serverError(res);
    try {
      res.end();
    } catch {}
  }
});

/**
 * Optional HTML preview
 * GET /api/invoices/:id/html
 *
 * UPDATED (boss): show Items when pricing_unit_type=item
 */
router.get('/:id/html', async (req: AuthRequest, res: Response) => {
  if (process.env.ENABLE_INVOICE_HTML_PREVIEW !== 'true') {
    return res.status(404).json({ success: false, error: 'Not found' });
  }

  const branchFilter = await getBranchFilterForRead(req, res);
  if (branchFilter === undefined) return;

  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const invoiceResult = await fetchInvoiceWithContext(id, branchFilter);
    if (invoiceResult.rows.length === 0) return notFound(res, 'Invoice not found');
    const row = invoiceResult.rows[0];

    const lineItemsResult = await query(
      `
      SELECT id, description, quantity, unit_price, amount
      FROM invoice_line_items
      WHERE invoice_id = $1
      ORDER BY id ASC
      `,
      [id]
    );

    const invoiceNo = safeText(row.invoice_number, 80) || 'document';

    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    const customerLabel =
      safeText(row.company_name, 150) ||
      (safeText(row.walk_in_name, 150) ? `WALK-IN: ${safeText(row.walk_in_name, 150)}` : 'WALK-IN');

    const txCompletedAt = row.second_weight_time || row.created_at || row.invoice_date;

    const unitType = String(row.pricing_unit_type || '').toLowerCase();
    const qty = num(row.pricing_quantity, 0);

    const ezLines = [
      `<div style="font-size:18px;font-weight:700">${escapeHtml(EZ.name)}</div>`,
      EZ.address ? `<div>${escapeHtml(EZ.address)}</div>` : '',
      EZ.phone ? `<div>Tel: ${escapeHtml(EZ.phone)}</div>` : '',
      EZ.email ? `<div>Email: ${escapeHtml(EZ.email)}</div>` : '',
    ].filter(Boolean);

    const branchLines = [
      row.branch_name ? `<div><strong>Branch:</strong> ${escapeHtml(safeText(row.branch_name, 120))}</div>` : '',
      row.branch_address ? `<div>${escapeHtml(safeText(row.branch_address, 200))}</div>` : '',
      row.branch_phone ? `<div>Tel: ${escapeHtml(safeText(row.branch_phone, 80))}</div>` : '',
    ].filter(Boolean);

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt ${escapeHtml(invoiceNo)}</title>
</head>
<body style="font-family:Arial,sans-serif;margin:32px">
  ${ezLines.join('\n')}

  <hr style="margin:12px 0" />

  <h2 style="margin:0 0 8px 0">WEIGHING RECEIPT</h2>

  <div><strong>Receipt #:</strong> ${escapeHtml(invoiceNo)}</div>
  <div><strong>Date:</strong> ${escapeHtml(fmtDate(row.invoice_date) || '')}</div>
  <div><strong>Time:</strong> ${escapeHtml(fmtTime(txCompletedAt) || '')}</div>
  ${branchLines.join('\n')}

  <hr style="margin:16px 0" />

  <h3 style="margin:0 0 8px 0">Customer</h3>
  <div>${escapeHtml(customerLabel)}</div>

  <h3 style="margin:20px 0 8px 0">Truck / Weighing</h3>
  <div><strong>Truck ID:</strong> ${escapeHtml(String(row.assigned_truck_id ?? ''))}</div>
  <div><strong>Truck-side #:</strong> ${escapeHtml(safeText(row.truck_side_number, 60))}</div>
  <div><strong>Transaction #:</strong> ${escapeHtml(safeText(row.transaction_number, 80))}</div>
  <div><strong>Material:</strong> ${escapeHtml(safeText(row.material_type, 80))}</div>
  <div><strong>Reference:</strong> ${escapeHtml(safeText(row.reference_number, 80))}</div>

  <div><strong>Scale-In:</strong> ${escapeHtml(money(row.first_weight))} kg (${escapeHtml(fmtDateTime(row.first_weight_time) || '')})</div>
  <div><strong>Scale-Out:</strong> ${escapeHtml(money(row.second_weight))} kg (${escapeHtml(fmtDateTime(row.second_weight_time) || '')})</div>
  <div><strong>Net Weight:</strong> ${escapeHtml(money(row.net_weight))} kg</div>
  ${unitType === 'item' && qty > 0 ? `<div><strong>Items:</strong> ${escapeHtml(String(Math.round(qty)))}</div>` : ''}

  <h3 style="margin:20px 0 8px 0">Charges</h3>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
    <thead>
      <tr>
        <th align="left">Description</th>
        <th align="right">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemsResult.rows
        .map(
          (it: any) => `
        <tr>
          <td>${escapeHtml(safeText(it.description, 500))}</td>
          <td align="right">${escapeHtml(money(it.amount))}</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>

  <div style="margin-top:16px;text-align:right">
    <div>Amount: ${escapeHtml(money(row.subtotal))}</div>
    <div>GST (${escapeHtml(String(GST_RATE))}%): ${escapeHtml(money(row.tax_amount))}</div>
    <div><strong>Total Amount: ${escapeHtml(money(row.total_amount))}</strong></div>
  </div>

  <div style="margin-top:14px">
    <div><strong>Status:</strong> ${escapeHtml(safeText(row.status, 40))}</div>
  </div>

  ${
    safeText(row.notes, 2000)
      ? `<hr style="margin:16px 0" /><div><strong>Notes:</strong> ${escapeHtml(safeText(row.notes, 2000))}</div>`
      : ''
  }
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${sanitizeFilename(invoiceNo)}.html"`);
    return res.send(html);
  } catch (error: any) {
    console.error('Invoice HTML preview error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * GET /api/invoices/:id/pdf (Receipt PDF)
 * - FULL is default always (simple only when explicitly requested)
 * - AUTO height: shrinks receipt to content unless ?height_mm=... is provided
 */
router.get('/:id/pdf', async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilterForRead(req, res);
  if (branchFilter === undefined) return;

  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  let doc: PdfDoc | null = null;
  let ended = false;

  const safeEndDoc = () => {
    if (ended) return;
    ended = true;
    try {
      doc?.end();
    } catch {}
  };

  try {
    const invoiceResult = await fetchInvoiceWithContext(id, branchFilter);
    if (invoiceResult.rows.length === 0) return notFound(res, 'Invoice not found');
    const row = invoiceResult.rows[0];

    const style = String(req.query.style ?? 'full').toLowerCase();
    const styleLabel = style === 'simple' ? 'simple' : 'full';

    const autoHeightMm = estimateReceiptHeightMm(row);
    const { widthPt, heightPt, marginPt, widthMm, heightMm, marginMm } = getReceiptPageSizeFromReq(req, autoHeightMm);

    const ticketNo = formatReceiptNumber(row.invoice_number) || formatReceiptNumber(row.transaction_number) || '—';
    const filename = sanitizeFilename(`receipt-${ticketNo}`) + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    res.setHeader('X-Receipt-Size', `${widthMm}x${heightMm}mm`);
    res.setHeader('X-Receipt-Margin', `${marginMm}mm`);
    res.setHeader('X-Receipt-Style', styleLabel);
    res.setHeader('X-Receipt-Height-Auto', `${autoHeightMm.toFixed(1)}mm`);

    doc = new PDFDocument({
      size: [widthPt, heightPt],
      margins: { top: marginPt, bottom: marginPt, left: marginPt, right: marginPt },
    });

    res.on('close', safeEndDoc);
    res.on('error', safeEndDoc);

    doc.on('error', () => {
      try {
        if (!res.headersSent) serverError(res);
        else res.end();
      } catch {}
    });

    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    if (styleLabel === 'simple') {
      drawSimpleWeighingReceipt(doc as any, pageW, row);
      safeEndDoc();
      return;
    }

    const locLabel = String(process.env.EZ_LOCATION_LABEL || 'SOUTHSIDE LOCATION').trim() || 'SOUTHSIDE LOCATION';

    const bodyTopY = drawReceiptTopBlock(doc as any, pageW, { ticketNo, locationLabel: locLabel });
    drawReceiptWatermark(doc as any, pageW, pageH, bodyTopY);

    let y = bodyTopY;
    const info = drawReceiptWeighingInfoBlock(doc as any, pageW, row, y);
    y = info.y;

    const safeInset = getReceiptSafeInsetPt();
    const contentLeft = doc.page.margins.left + safeInset;
    const contentRight = pageW - doc.page.margins.right - safeInset;
    const contentWidth = Math.max(0, contentRight - contentLeft);

    doc.y = y;
    doc.moveDown(1.0);

    // separator
    doc.save();
    doc.strokeColor('#111').lineWidth(0.7);
    doc.moveTo(contentLeft, doc.y).lineTo(contentRight, doc.y).stroke();
    doc.restore();

    doc.moveDown(0.8);

    // Net below separator
    if (Number.isFinite(info.net) && info.net >= 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#111');
      doc.text(`Net ${Math.round(info.net)} kg`, contentLeft, doc.y, {
        width: contentWidth,
        align: 'left',
      });
      doc.moveDown(0.6);
    }

    const customer = safeText(row.company_name, 150) || (safeText(row.walk_in_name, 150) ? safeText(row.walk_in_name, 150) : '');
    const po = safeText(row.reference_number, 80);
    const weighedBy = safeText((req.user as any)?.name, 80) || safeText((req.user as any)?.username, 80) || '';

    drawLineField(doc as any, 'Customer', customer || '');
    drawLineField(doc as any, 'PO Number', po || '');
    drawLineField(doc as any, 'Weighed by', weighedBy || '');
    drawLineField(doc as any, 'Customer Sign', '');

    safeEndDoc();
  } catch (error: any) {
    console.error('Generate POS receipt PDF error', { code: error?.code, message: error?.message });

    safeEndDoc();

    if (!res.headersSent) return serverError(res);
    try {
      res.end();
    } catch {}
  }
});

/**
 * GET /api/invoices/:id (JSON detail)
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilterForRead(req, res);
  if (branchFilter === undefined) return;

  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const invoiceResult = await fetchInvoiceWithContext(id, branchFilter);
    if (invoiceResult.rows.length === 0) return notFound(res, 'Invoice not found');

    const items = await query(
      `
      SELECT id, description, quantity, unit_price, amount
      FROM invoice_line_items
      WHERE invoice_id = $1
      ORDER BY id ASC
      `,
      [id]
    );

    return res.json({
      success: true,
      data: {
        invoice: invoiceResult.rows[0],
        items: items.rows,
      },
    });
  } catch (error: any) {
    console.error('Get invoice detail error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

export default router;