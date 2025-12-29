import { Router, Response } from 'express';
import PDFDocument from 'pdfkit';
import { query } from '../../db.js';
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

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
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
  // prevent header issues + keep filenames OS-safe
  const base = (v || 'invoice').replace(/[\r\n]/g, ' ').trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned.slice(0, maxLen) || 'invoice';
}

/**
 * Branch resolution (temporary until schema is confirmed).
 */
async function resolveUserBranchId(userId: string): Promise<string | null> {
  // 1) users.branch_id
  try {
    const r1 = await query(`SELECT branch_id FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r1.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  // 2) user_profiles.branch_id (user_profiles.user_id)
  try {
    const r2 = await query(`SELECT branch_id FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    const bid = r2.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  // 3) user_profiles.branch_id (user_profiles.id == users.id)
  try {
    const r3 = await query(`SELECT branch_id FROM user_profiles WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r3.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  return null;
}

/**
 * Branch scoping:
 * - operator: forced to own branch
 * - admin/manager: may use ?branch_id=... or default to own
 * - if admin/manager has no assignment => must pass branch_id (production-safe)
 */
async function getScopedBranchId(req: AuthRequest, res: Response): Promise<string | null> {
  const userId = req.user?.id;
  const role = req.user?.role;

  if (!userId || !role) {
    forbidden(res, 'Unauthorized');
    return null;
  }

  const requestedBranch =
    typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';

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

/**
 * Optional HTML preview (disabled by default in production)
 * GET /api/invoices/:id/html
 */
router.get('/:id/html', async (req: AuthRequest, res: Response) => {
  if (process.env.ENABLE_INVOICE_HTML_PREVIEW !== 'true') {
    return res.status(404).json({ success: false, error: 'Not found' });
  }

  const branchId = await getScopedBranchId(req, res);
  if (!branchId) return;

  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const invoiceResult = await query(
      `SELECT
        i.id, i.branch_id, i.client_id, i.invoice_number, i.invoice_date, i.due_date,
        i.subtotal, i.tax_rate, i.tax_amount, i.total_amount, i.paid_amount, i.balance,
        i.payment_terms, i.status,
        c.company_name, c.contact_person, c.address, c.phone, c.email
       FROM invoices i
       LEFT JOIN clients c ON i.client_id = c.id
       WHERE i.id = $1 AND i.branch_id = $2`,
      [id, branchId]
    );

    if (invoiceResult.rows.length === 0) return notFound(res, 'Invoice not found');
    const row = invoiceResult.rows[0];

    const lineItemsResult = await query(
      `SELECT id, description, quantity, unit_price, amount
       FROM invoice_line_items
       WHERE invoice_id = $1
       ORDER BY id ASC`,
      [id]
    );

    const invoiceNo = safeText(row.invoice_number, 80) || 'invoice';

    // Hard lock down the preview
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(invoiceNo)}</title></head>
<body style="font-family:Arial,sans-serif;margin:32px">
  <h1 style="margin:0 0 12px 0">INVOICE</h1>
  <div><strong>Invoice #:</strong> ${escapeHtml(invoiceNo)}</div>
  <div><strong>Date:</strong> ${escapeHtml(new Date(row.invoice_date).toLocaleDateString())}</div>
  <div><strong>Due:</strong> ${escapeHtml(new Date(row.due_date).toLocaleDateString())}</div>
  <hr style="margin:16px 0" />
  <h3 style="margin:0 0 8px 0">Bill To</h3>
  <div>${escapeHtml(safeText(row.company_name, 150))}</div>
  <div>${escapeHtml(safeText(row.contact_person, 150))}</div>
  <div>${escapeHtml(safeText(row.address, 250))}</div>
  <div>Phone: ${escapeHtml(safeText(row.phone, 80))}</div>
  <div>Email: ${escapeHtml(safeText(row.email, 120))}</div>

  <h3 style="margin:20px 0 8px 0">Items</h3>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
    <thead><tr>
      <th align="left">Description</th><th align="right">Qty</th><th align="right">Unit</th><th align="right">Amount</th>
    </tr></thead>
    <tbody>
      ${lineItemsResult.rows
        .map((it: any) => `
        <tr>
          <td>${escapeHtml(safeText(it.description, 500))}</td>
          <td align="right">${escapeHtml(safeText(it.quantity, 40))}</td>
          <td align="right">${escapeHtml(money(it.unit_price))}</td>
          <td align="right">${escapeHtml(money(it.amount))}</td>
        </tr>
      `)
        .join('')}
    </tbody>
  </table>

  <div style="margin-top:16px;text-align:right">
    <div>Subtotal: ${escapeHtml(money(row.subtotal))}</div>
    <div>Tax (${escapeHtml(String(num(row.tax_rate, 0)))}%): ${escapeHtml(money(row.tax_amount))}</div>
    <div><strong>Total: ${escapeHtml(money(row.total_amount))}</strong></div>
    <div>Paid: ${escapeHtml(money(row.paid_amount))}</div>
    <div><strong>Balance: ${escapeHtml(money(row.balance))}</strong></div>
  </div>

  <div style="margin-top:20px">
    <div><strong>Terms:</strong> ${escapeHtml(safeText(row.payment_terms, 80))}</div>
    <div><strong>Status:</strong> ${escapeHtml(safeText(row.status, 40))}</div>
  </div>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${sanitizeFilename(invoiceNo)}.html"`);
    return res.send(html);
  } catch (error: any) {
    console.error('Invoice HTML preview error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * GET /api/invoices
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const branchId = await getScopedBranchId(req, res);
  if (!branchId) return;

  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;

  try {
    const result = await query(
      `SELECT
        i.id, i.invoice_number, i.invoice_date, i.status,
        i.total_amount, i.paid_amount, i.balance, i.created_at,
        c.company_name
       FROM invoices i
       LEFT JOIN clients c ON i.client_id = c.id
       WHERE i.branch_id = $1
       ORDER BY i.created_at DESC
       LIMIT $2`,
      [branchId, limit]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Get invoices error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

/**
 * GET /api/invoices/:id/pdf
 * ✅ REAL PDF
 */
router.get('/:id/pdf', async (req: AuthRequest, res: Response) => {
  const branchId = await getScopedBranchId(req, res);
  if (!branchId) return;

  const id = String(req.params.id || '').trim();
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const invoiceResult = await query(
      `SELECT
        i.id, i.branch_id, i.client_id, i.invoice_number, i.invoice_date, i.due_date,
        i.subtotal, i.tax_rate, i.tax_amount, i.total_amount, i.paid_amount, i.balance,
        i.payment_terms, i.status,
        c.company_name, c.contact_person, c.address, c.phone, c.email
       FROM invoices i
       LEFT JOIN clients c ON i.client_id = c.id
       WHERE i.id = $1 AND i.branch_id = $2`,
      [id, branchId]
    );

    if (invoiceResult.rows.length === 0) return notFound(res, 'Invoice not found');
    const row = invoiceResult.rows[0];

    const lineItemsResult = await query(
      `SELECT id, description, quantity, unit_price, amount
       FROM invoice_line_items
       WHERE invoice_id = $1
       ORDER BY id ASC`,
      [id]
    );

    const invoiceNumber = safeText(row.invoice_number, 80) || 'invoice';
    const filename = sanitizeFilename(`invoice-${invoiceNumber}`) + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    // If client disconnects, stop work
    let closed = false;
    res.on('close', () => {
      closed = true;
      try { doc.end(); } catch {}
    });

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('INVOICE', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Invoice #: ${invoiceNumber}`);
    doc.text(`Date: ${new Date(row.invoice_date).toLocaleDateString()}`);
    doc.text(`Due Date: ${new Date(row.due_date).toLocaleDateString()}`);
    doc.text(`Status: ${safeText(row.status, 40)}`);
    doc.moveDown();

    // Bill To
    doc.fontSize(12).text('Bill To:', { underline: true });
    doc.fontSize(11).text(safeText(row.company_name, 150));
    doc.text(safeText(row.contact_person, 150));
    const addr = safeText(row.address, 250);
    if (addr) doc.text(addr);
    const phone = safeText(row.phone, 80);
    if (phone) doc.text(`Phone: ${phone}`);
    const email = safeText(row.email, 120);
    if (email) doc.text(`Email: ${email}`);
    doc.moveDown();

    // Items
    doc.fontSize(12).text('Items:', { underline: true });
    doc.moveDown(0.5);

    const startX = doc.x;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const colDesc = startX;
    const colQty = startX + pageWidth * 0.60;
    const colUnit = startX + pageWidth * 0.72;
    const colAmt = startX + pageWidth * 0.86;

    const rowYStart = doc.y;

    doc.fontSize(10).text('Description', colDesc, rowYStart);
    doc.text('Qty', colQty, rowYStart, { width: pageWidth * 0.10, align: 'right' });
    doc.text('Unit', colUnit, rowYStart, { width: pageWidth * 0.12, align: 'right' });
    doc.text('Amount', colAmt, rowYStart, { width: pageWidth * 0.14, align: 'right' });

    doc.moveDown(0.4);
    doc.moveTo(startX, doc.y).lineTo(startX + pageWidth, doc.y).stroke();
    doc.moveDown(0.4);

    doc.fontSize(10);

    for (const it of lineItemsResult.rows as any[]) {
      if (closed) break;

      if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
        doc.addPage();
      }

      const desc = safeText(it.description, 500);
      const qty = safeText(it.quantity, 40);
      const unitP = money(it.unit_price);
      const amt = money(it.amount);

      const y = doc.y;

      doc.text(desc, colDesc, y, { width: pageWidth * 0.58 });
      doc.text(qty, colQty, y, { width: pageWidth * 0.10, align: 'right' });
      doc.text(unitP, colUnit, y, { width: pageWidth * 0.12, align: 'right' });
      doc.text(amt, colAmt, y, { width: pageWidth * 0.14, align: 'right' });

      doc.moveDown(0.9);
    }

    if (!closed) {
      doc.moveDown();

      // Totals
      const rightX = startX + pageWidth * 0.60;
      doc.fontSize(11);
      doc.text(`Subtotal: ${money(row.subtotal)}`, rightX, doc.y, { align: 'right' });
      doc.text(`Tax (${num(row.tax_rate, 0)}%): ${money(row.tax_amount)}`, rightX, doc.y, { align: 'right' });
      doc.fontSize(12).text(`Total: ${money(row.total_amount)}`, rightX, doc.y, { align: 'right' });
      doc.fontSize(11).text(`Paid: ${money(row.paid_amount)}`, rightX, doc.y, { align: 'right' });
      doc.fontSize(12).text(`Balance: ${money(row.balance)}`, rightX, doc.y, { align: 'right' });

      doc.moveDown();
      doc.fontSize(10).text(`Payment Terms: ${safeText(row.payment_terms, 80)}`);
    }

    doc.end();
  } catch (error: any) {
    console.error('Generate invoice PDF error', { code: error?.code, message: error?.message });
    if (!res.headersSent) return serverError(res);
    try { res.end(); } catch {}
  }
});

export default router;
