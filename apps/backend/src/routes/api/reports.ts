// apps/backend/src/routes/api/reports.ts
import { Router, type Response } from 'express';
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

const router = Router();

/**
 * OPTIONAL (helps Electron / direct-download):
 * If a client opens a URL directly (window.open / <a href>),
 * it won't include Authorization header.
 * Allow passing ?token=... which we map to Authorization.
 */
router.use((req, _res, next) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const auth = String((req.headers as any)?.authorization || '').trim();
    if (!auth && token) {
      (req.headers as any).authorization = token.toLowerCase().startsWith('bearer ')
        ? token
        : `Bearer ${token}`;
    }
  } catch {}
  next();
});

// JWT-protected
router.use(authenticate);
router.use(requireRole(['operator', 'admin', 'manager']));

// --------------------
// Small helpers
// --------------------
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

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function parseISODate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
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

function num(v: unknown, fallback = 0): number {
  const n = parseNumberStrict(v);
  return n === null ? fallback : n;
}

function safeText(v: unknown, maxLen = 240): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function fmtDateISO(d: any): string {
  try {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const da = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  } catch {
    return '';
  }
}

function fmtDateTimeShort(d: any): string {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// --------------------
// Branding / env
// --------------------
const ACCENT_GREEN = process.env.EZ_GREEN || '#2E8B57';
const MUTED = '#6B7280';
const LIGHT_BG = '#F3F4F6';
const BORDER = '#D1D5DB';

const EZ = {
  name: process.env.EZ_NAME || 'EZ WASTE MANAGEMENT',
  address: process.env.EZ_ADDRESS || '2411-76 Ave NW, Edmonton, AB T6P 1P6',
  phone: process.env.EZ_PHONE || '780-915-1998',
  email: process.env.EZ_EMAIL || 'customersupport@ezwm.ca',
  locationLabel: process.env.EZ_LOCATION_LABEL || '',
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

function resolveStatementWatermarkPath(): string | null {
  const candidates: string[] = [];

  if (process.env.EZ_RECYCLE_WATERMARK_PATH) candidates.push(process.env.EZ_RECYCLE_WATERMARK_PATH);

  candidates.push(path.resolve(process.cwd(), 'apps/backend/assets/recycle.png'));
  candidates.push(path.resolve(process.cwd(), 'apps/backend/assets/watermark.png'));

  candidates.push(path.resolve(__dirname, '../../../assets/recycle.png'));
  candidates.push(path.resolve(__dirname, '../../../assets/watermark.png'));

  candidates.push('/app/assets/recycle.png');
  candidates.push('/app/assets/watermark.png');

  for (const p of candidates) {
    if (existingFile(p)) return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  }
  return null;
}

// --------------------
// Branch scoping
// --------------------
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

async function getBranchFilter(req: AuthRequest, res: Response): Promise<string | null | undefined> {
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

async function getBranchLabel(branchId: string | null) {
  if (!branchId) return '';
  try {
    const r = await query(`SELECT code, name FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
    const code = safeText(r.rows?.[0]?.code, 20);
    const name = safeText(r.rows?.[0]?.name, 80);
    if (code && name) return `${code} (${name})`;
    return code || name || '';
  } catch {
    return '';
  }
}

// --------------------
// Reports: Summary + list + CSV
// --------------------

router.get('/summary', async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilter(req, res);
  if (branchFilter === undefined) return;

  const from = parseISODate(req.query.from) || null;
  const to = parseISODate(req.query.to) || null;

  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id.trim() : '';

  if (clientId && !isUuid(clientId)) return badRequest(res, 'Invalid client_id');

  const dateFrom = from || '1970-01-01';
  const dateTo = to || '2100-01-01';

  try {
    const r = await query(
      `
      SELECT
        COUNT(*)::int AS transactions,
        SUM(CASE WHEN LOWER(COALESCE(t.status,'')) = 'completed' THEN 1 ELSE 0 END)::int AS completed,
        COALESCE(SUM(COALESCE(t.net_weight, 0)), 0)::numeric AS total_net_weight
      FROM transactions t
      WHERE ($1::uuid IS NULL OR t.branch_id = $1)
        AND COALESCE(t.second_weight_time, t.created_at) >= $2::date
        AND COALESCE(t.second_weight_time, t.created_at) < ($3::date + INTERVAL '1 day')
        AND ($4::text = '' OR LOWER(COALESCE(t.status,'')) = LOWER($4))
        AND ($5::uuid IS NULL OR t.client_id = $5)
      `,
      [branchFilter, dateFrom, dateTo, status, clientId ? clientId : null]
    );

    const row = r.rows?.[0] || {};
    return res.json({
      success: true,
      data: {
        transactions: Number(row.transactions || 0),
        completed: Number(row.completed || 0),
        total_net_weight: Number(row.total_net_weight || 0),
      },
    });
  } catch (error: any) {
    console.error('Reports summary error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

router.get('/transactions', async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilter(req, res);
  if (branchFilter === undefined) return;

  const from = parseISODate(req.query.from) || null;
  const to = parseISODate(req.query.to) || null;

  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id.trim() : '';

  const limitRaw = parseIntStrict(req.query.limit);
  const offsetRaw = parseIntStrict(req.query.offset);
  const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 500) : 100;
  const offset = offsetRaw !== null ? Math.max(offsetRaw, 0) : 0;

  if (clientId && !isUuid(clientId)) return badRequest(res, 'Invalid client_id');

  const dateFrom = from || '1970-01-01';
  const dateTo = to || '2100-01-01';

  try {
    const r = await query(
      `
      SELECT
        t.id,
        t.transaction_number,
        t.status,
        t.net_weight,
        t.created_at,
        t.second_weight_time,
        t.truck_side_number,
        t.assigned_truck_id,
        COALESCE(c.company_name, NULLIF(t.walk_in_name, ''), 'WALK-IN') AS client_name
      FROM transactions t
      LEFT JOIN clients c ON c.id = t.client_id
      WHERE ($1::uuid IS NULL OR t.branch_id = $1)
        AND COALESCE(t.second_weight_time, t.created_at) >= $2::date
        AND COALESCE(t.second_weight_time, t.created_at) < ($3::date + INTERVAL '1 day')
        AND ($4::text = '' OR LOWER(COALESCE(t.status,'')) = LOWER($4))
        AND ($5::uuid IS NULL OR t.client_id = $5)
      ORDER BY COALESCE(t.second_weight_time, t.created_at) DESC
      LIMIT $6 OFFSET $7
      `,
      [branchFilter, dateFrom, dateTo, status, clientId ? clientId : null, limit, offset]
    );

    return res.json({ success: true, data: r.rows });
  } catch (error: any) {
    console.error('Reports transactions error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

router.get('/transactions.csv', async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilter(req, res);
  if (branchFilter === undefined) return;

  const from = parseISODate(req.query.from) || null;
  const to = parseISODate(req.query.to) || null;

  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id.trim() : '';
  if (clientId && !isUuid(clientId)) return badRequest(res, 'Invalid client_id');

  const dateFrom = from || '1970-01-01';
  const dateTo = to || '2100-01-01';

  try {
    const r = await query(
      `
      SELECT
        COALESCE(t.second_weight_time, t.created_at) AS created_at,
        t.transaction_number,
        COALESCE(c.company_name, NULLIF(t.walk_in_name, ''), 'WALK-IN') AS client_name,
        t.status,
        t.net_weight,
        COALESCE(t.truck_side_number, '') AS truck_side_number
      FROM transactions t
      LEFT JOIN clients c ON c.id = t.client_id
      WHERE ($1::uuid IS NULL OR t.branch_id = $1)
        AND COALESCE(t.second_weight_time, t.created_at) >= $2::date
        AND COALESCE(t.second_weight_time, t.created_at) < ($3::date + INTERVAL '1 day')
        AND ($4::text = '' OR LOWER(COALESCE(t.status,'')) = LOWER($4))
        AND ($5::uuid IS NULL OR t.client_id = $5)
      ORDER BY COALESCE(t.second_weight_time, t.created_at) DESC
      `,
      [branchFilter, dateFrom, dateTo, status, clientId ? clientId : null]
    );

    const lines: string[] = [];
    lines.push(['Date', 'Transaction', 'Client', 'Status', 'Net (kg)', 'Truck'].join(','));

    for (const row of r.rows) {
      const dt = fmtDateISO((row as any).created_at);
      const tx = safeText((row as any).transaction_number, 80);
      const cn = safeText((row as any).client_name, 120).replace(/,/g, ' ');
      const st = safeText((row as any).status, 40);
      const net = num((row as any).net_weight, 0).toFixed(2);
      const truck = safeText((row as any).truck_side_number, 40).replace(/,/g, ' ');
      lines.push([dt, tx, cn, st, net, truck].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }

    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(csv);
  } catch (error: any) {
    console.error('Reports CSV error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

// --------------------
// Monthly statement (PDF)
// --------------------
type StatementRow = {
  date: string;
  invoice: string;
  gross: number;
  tare: number;
  net: number;
  total: number;
  paid: number;
  balance: number;
};

async function buildClientStatementRows(args: {
  clientId: string;
  from: string;
  to: string;
  branchFilter: string | null;
  includePaid: boolean;
}) {
  const { clientId, from, to, branchFilter, includePaid } = args;

  const clientRes = await query(
    `
    SELECT company_name, contact_person, address, phone, email, branch_id
    FROM clients
    WHERE id = $1
    LIMIT 1
    `,
    [clientId]
  );
  if (clientRes.rows.length === 0) return { client: null, rows: [] as StatementRow[] };

  const client = clientRes.rows[0];

  const rowsRes = await query(
    `
    SELECT
      i.invoice_number,
      i.invoice_date,
      i.total_amount,
      i.paid_amount,
      i.balance,
      i.status,
      i.branch_id,

      t.first_weight,
      t.second_weight,
      t.net_weight,
      t.second_weight_time,
      i.created_at,

      COALESCE(i.transaction_id, li_tx.transaction_id) AS tx_id

    FROM invoices i

    LEFT JOIN LATERAL (
      SELECT li.transaction_id
      FROM invoice_line_items li
      WHERE li.invoice_id = i.id AND li.transaction_id IS NOT NULL
      ORDER BY li.id ASC
      LIMIT 1
    ) li_tx ON true

    LEFT JOIN transactions t ON t.id = COALESCE(i.transaction_id, li_tx.transaction_id)

    WHERE i.client_id = $1
      AND i.status <> 'cancelled'
      AND ($2::uuid IS NULL OR i.branch_id = $2)
      AND COALESCE(t.second_weight_time, i.created_at) >= $3::date
      AND COALESCE(t.second_weight_time, i.created_at) < ($4::date + INTERVAL '1 day')
      AND ($5::boolean OR COALESCE(i.balance, 0) > 0.00001)
    ORDER BY COALESCE(t.second_weight_time, i.created_at) ASC, i.invoice_number ASC
    `,
    [clientId, branchFilter, from, to, includePaid]
  );

  const rows: StatementRow[] = [];

  for (const r of rowsRes.rows as any[]) {
    const dt = r.second_weight_time || r.invoice_date || r.created_at;
    const date = fmtDateISO(dt);

    const w1 = num(r.first_weight, NaN);
    const w2 = num(r.second_weight, NaN);

    const hasBoth = Number.isFinite(w1) && w1 > 0 && Number.isFinite(w2) && w2 > 0;
    const gross = hasBoth ? Math.max(w1, w2) : Number.isFinite(w1) ? w1 : Number.isFinite(w2) ? w2 : 0;
    const tare = hasBoth ? Math.min(w1, w2) : 0;

    let netW = num(r.net_weight, NaN);
    if (!Number.isFinite(netW) || netW < 0) {
      netW = hasBoth ? Math.max(0, gross - tare) : 0;
    }

    rows.push({
      date,
      invoice: safeText(r.invoice_number, 80),
      gross: Number(gross || 0),
      tare: Number(tare || 0),
      net: Number(netW || 0),
      total: Number(num(r.total_amount, 0)),
      paid: Number(num(r.paid_amount, 0)),
      balance: Number(num(r.balance, 0)),
    });
  }

  return { client, rows };
}

/**
 * Draw watermark safely (does NOT change doc.x/doc.y).
 */
function drawStatementWatermark(doc: PdfDoc) {
  const prevX = doc.x;
  const prevY = doc.y;

  const wm = resolveStatementWatermarkPath();

  doc.save();
  try {
    doc.opacity(0.06);
    if (wm) {
      const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const size = Math.min(420, contentW);
      const x = doc.page.margins.left + (contentW - size) / 2;
      const y = doc.page.height * 0.52 - size * 0.35;
      doc.image(wm, x, y, { width: size });
    } else {
      const cx = doc.page.width / 2;
      const cy = doc.page.height / 2;
      doc.fillColor('#999').font('Helvetica-Bold').fontSize(70);
      doc.rotate(-20, { origin: [cx, cy] });
      doc.text('RECYCLE', doc.page.margins.left, cy - 40, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
      });
      doc.rotate(20, { origin: [cx, cy] });
    }
  } catch {
    // ignore
  } finally {
    doc.restore();
    doc.x = prevX;
    doc.y = prevY;
  }
}

function ellipsizeToWidth(doc: PdfDoc, text: string, maxW: number) {
  const s = String(text ?? '');
  if (!s) return '';
  if (doc.widthOfString(s) <= maxW) return s;

  const ell = '…';
  const ellW = doc.widthOfString(ell);
  if (ellW >= maxW) return '';

  let lo = 0;
  let hi = s.length;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = s.slice(0, mid) + ell;
    if (doc.widthOfString(candidate) <= maxW) lo = mid + 1;
    else hi = mid;
  }

  const cut = Math.max(0, lo - 1);
  return s.slice(0, cut) + ell;
}

function drawFooter(doc: PdfDoc) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;

  const lines: string[] = [];
  if (EZ.locationLabel) lines.push(String(EZ.locationLabel).trim());
  if (EZ.address) lines.push(String(EZ.address).trim());

  const footerH = 58;
  const y = doc.page.height - doc.page.margins.bottom - footerH + 6;

  doc.save();
  try {
    doc.strokeColor(ACCENT_GREEN).lineWidth(1);
    doc.moveTo(left, y - 10).lineTo(right, y - 10).stroke();

    // Address (black)
    if (lines.length) {
      doc.fillColor('#111').font('Helvetica').fontSize(9);
      doc.text(lines.join('\n'), left, y, { width: contentW, align: 'center' });
    }

    // Phone (green)
    const phoneLine = EZ.phone ? `Ph: ${String(EZ.phone).trim()}` : '';
    if (phoneLine) {
      doc.fillColor(ACCENT_GREEN).font('Helvetica-Bold').fontSize(9);
      doc.text(phoneLine, left, y + 22, { width: contentW, align: 'center' });
    }

    // Email (black)
    const emailLine = EZ.email ? `Email: ${String(EZ.email).trim()}` : '';
    if (emailLine) {
      doc.fillColor('#111').font('Helvetica').fontSize(9);
      doc.text(emailLine, left, y + 36, { width: contentW, align: 'center' });
    }
  } finally {
    doc.restore();
  }
}

function drawHeader(doc: PdfDoc, opts: { title: string; subtitle: string }) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;

  // watermark behind everything
  drawStatementWatermark(doc);

  // Title centered (green)
  doc.fillColor(ACCENT_GREEN).font('Helvetica-Bold').fontSize(20);
  doc.text(opts.title, left, doc.y, { width: contentW, align: 'center' });

  // Subtitle centered (black) - moved DOWN so the separator doesn't cross it
  doc.moveDown(0.55);
  doc.fillColor('#111').font('Helvetica').fontSize(12);
  doc.text(opts.subtitle, left, doc.y, { width: contentW, align: 'center' });

  // Add a little breathing room BEFORE the line
  doc.moveDown(0.65);

  // Green separator line (NOW below subtitle)
  doc.save();
  doc.strokeColor(ACCENT_GREEN).lineWidth(1);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
  doc.restore();

  doc.moveDown(0.9);
}

function drawClientMetaBlock(doc: PdfDoc, args: { clientName: string; periodLabel: string; branchText: string; generatedText: string }) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;

  const colW = Math.floor(contentW / 2);

  const y0 = doc.y;

  // Left: Client + Period
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(11);
  doc.text(`Client: ${args.clientName || '—'}`, left, y0, { width: colW, align: 'left' });

  doc.fillColor('#111').font('Helvetica').fontSize(11);
  doc.text(`Period: ${args.periodLabel}`, left, y0 + 16, { width: colW, align: 'left' });

  // Right: Branch + Generated (moved here per your request)
  doc.fillColor(MUTED).font('Helvetica').fontSize(9);
  doc.text(args.branchText, left + colW, y0 + 1, { width: colW, align: 'right' });
  doc.text(args.generatedText, left + colW, y0 + 15, { width: colW, align: 'right' });

  doc.y = y0 + 38;
  doc.moveDown(0.4);
}

function drawCellText(doc: PdfDoc, text: string, x: number, y: number, w: number, align: 'left' | 'right') {
  const padding = 6;
  const maxW = Math.max(10, w - padding * 2);

  // Try font sizes down to 7 to avoid wrapping (keeps values intact)
  let chosen = 10;
  for (let s = 10; s >= 7; s--) {
    doc.fontSize(s);
    if (doc.widthOfString(text) <= maxW) {
      chosen = s;
      break;
    }
  }
  doc.fontSize(chosen);

  // If still too wide (extreme case), ellipsize (mostly affects invoice)
  const out = doc.widthOfString(text) <= maxW ? text : ellipsizeToWidth(doc, text, maxW);

  doc.text(out, x + padding, y + 6, {
    width: w - padding * 2,
    align,
    lineBreak: false, // key: prevents date/invoice splitting to multiple lines
  });
}

async function renderStatementPdfBuffer(args: {
  clientName: string;
  periodLabel: string;
  branchText: string;
  rows: StatementRow[];
  unpaidOnly: boolean;
}) {
  const { clientName, periodLabel, branchText, rows, unpaidOnly } = args;

  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  const chunks: Buffer[] = [];
  doc.on('data', (b) => chunks.push(Buffer.from(b)));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const generatedText = `Generated: ${fmtDateTimeShort(new Date())}`;
  const subtitle = unpaidOnly ? 'Monthly Statement (Unpaid)' : 'Monthly Statement';
  const title = String(EZ.name || 'EZ WASTE MANAGEMENT').trim();

  const drawPageChrome = () => {
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;
    drawHeader(doc as any, { title, subtitle });
    drawClientMetaBlock(doc as any, { clientName, periodLabel, branchText, generatedText });
  };

  drawPageChrome();
  doc.on('pageAdded', drawPageChrome);

  // ---- TABLE (keep same style, fix wrapping/alignment) ----
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;

  // Width plan (prevents date/invoice wrapping):
  // Date 70, Invoice 125, Gross 48, Tare 48, Net 48, Total 54, Paid 48, Balance 54  => sums ~495 on A4 with margin 50
  const base = [70, 125, 48, 48, 48, 54, 48, 54];
  const baseSum = base.reduce((a, b) => a + b, 0);
  const scale = contentW / baseSum;

  const w = base.map((v) => Math.floor(v * scale));
  const drift = contentW - w.reduce((a, b) => a + b, 0);
  w[w.length - 1] += drift;

  const xDate = left;
  const xInv = xDate + w[0];
  const xGross = xInv + w[1];
  const xTare = xGross + w[2];
  const xNet = xTare + w[3];
  const xTotal = xNet + w[4];
  const xPaid = xTotal + w[5];
  const xBal = xPaid + w[6];

  const rowH = 20;

  const drawTableHeader = () => {
    const y = doc.y;

    doc.save();
    doc.rect(left, y, contentW, rowH).fill(LIGHT_BG);
    doc.strokeColor(BORDER).lineWidth(0.8);
    doc.rect(left, y, contentW, rowH).stroke();
    doc.restore();

    doc.fillColor('#111').font('Helvetica-Bold').fontSize(10);

    // headers (align numeric headers with numeric values)
    doc.text('Date', xDate + 6, y + 6, { width: w[0] - 12, align: 'left' });
    doc.text('Invoice', xInv + 6, y + 6, { width: w[1] - 12, align: 'left' });

    doc.text('Gross', xGross + 6, y + 6, { width: w[2] - 12, align: 'right' });
    doc.text('Tare', xTare + 6, y + 6, { width: w[3] - 12, align: 'right' });
    doc.text('Net', xNet + 6, y + 6, { width: w[4] - 12, align: 'right' });
    doc.text('Total', xTotal + 6, y + 6, { width: w[5] - 12, align: 'right' });
    doc.text('Paid', xPaid + 6, y + 6, { width: w[6] - 12, align: 'right' });
    doc.text('Balance', xBal + 6, y + 6, { width: w[7] - 12, align: 'right' });

    doc.y = y + rowH;
  };

  drawTableHeader();

  let totalNet = 0;
  let totalAmt = 0;
  let totalPaid = 0;
  let totalBal = 0;

  const ensureSpace = (needed: number) => {
    const footerReserve = 78;
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom - footerReserve) {
      doc.addPage();
      drawTableHeader();
    }
  };

  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    ensureSpace(rowH);

    const y = doc.y;

    // zebra (same style)
    if (i % 2 === 1) {
      doc.save();
      doc.fillColor('#FAFAFA');
      doc.rect(left, y, contentW, rowH).fill();
      doc.restore();
    }

    // borders
    doc.save();
    doc.strokeColor(BORDER).lineWidth(0.6);
    doc.rect(left, y, contentW, rowH).stroke();
    doc.restore();

    doc.fillColor('#111').font('Helvetica').fontSize(10);

    // cells (NO wrapping)
    drawCellText(doc as any, r.date, xDate, y, w[0], 'left');

    // Invoice: ellipsize if needed, but never wrap
    const inv = safeText(r.invoice, 120);
    drawCellText(doc as any, inv, xInv, y, w[1], 'left');

    drawCellText(doc as any, fmt(r.gross), xGross, y, w[2], 'right');
    drawCellText(doc as any, fmt(r.tare), xTare, y, w[3], 'right');
    drawCellText(doc as any, fmt(r.net), xNet, y, w[4], 'right');
    drawCellText(doc as any, fmt(r.total), xTotal, y, w[5], 'right');
    drawCellText(doc as any, fmt(r.paid), xPaid, y, w[6], 'right');
    drawCellText(doc as any, fmt(r.balance), xBal, y, w[7], 'right');

    doc.y = y + rowH;

    totalNet += Number(r.net || 0);
    totalAmt += Number(r.total || 0);
    totalPaid += Number(r.paid || 0);
    totalBal += Number(r.balance || 0);
  }

  // ---- SUMMARY (bottom-left) ----
  const footerReserve = 78;
  const summaryH = 90;
  if (doc.y + summaryH > doc.page.height - doc.page.margins.bottom - footerReserve) {
    doc.addPage();
  }

  const yBottomTarget = doc.page.height - doc.page.margins.bottom - footerReserve - summaryH;
  doc.y = Math.max(doc.y + 14, yBottomTarget);

  doc.fillColor('#111').font('Helvetica-Bold').fontSize(12);
  doc.text('Summary', left, doc.y);
  doc.moveDown(0.4);

  doc.fillColor('#111').font('Helvetica').fontSize(11);
  doc.text(`Total net weight: ${totalNet.toFixed(2)} kg`, left);
  doc.text(`Total amount: ${totalAmt.toFixed(2)}`, left);
  doc.text(`Total paid: ${totalPaid.toFixed(2)}`, left);
  doc.font('Helvetica-Bold').text(`Balance due: ${totalBal.toFixed(2)}`, left);

  // Footer (company details)
  drawFooter(doc as any);

  doc.end();
  return done;
}

// ---- IMPORTANT: keep this endpoint name (your UI calls it) ----
// GET /api/reports/client-statement   -> JSON { pdf_base64 }
router.get('/client-statement', async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilter(req, res);
  if (branchFilter === undefined) return;

  const clientId = String(req.query.client_id || '').trim();
  if (!isUuid(clientId)) return badRequest(res, 'client_id must be a UUID');

  const from = parseISODate(req.query.from);
  const to = parseISODate(req.query.to);
  if (!from || !to) return badRequest(res, 'from and to are required (YYYY-MM-DD)');

  const unpaidOnlyRaw = String(req.query.unpaid_only ?? '').trim().toLowerCase();
  const unpaidOnly = unpaidOnlyRaw === '1' || unpaidOnlyRaw === 'true' || unpaidOnlyRaw === 'yes';

  const includePaidRaw = String(req.query.include_paid ?? '').trim().toLowerCase();
  const includePaid = includePaidRaw === '1' || includePaidRaw === 'true' || includePaidRaw === 'yes';

  const effectiveIncludePaid = unpaidOnly ? false : includePaid;

  try {
    if (branchFilter) {
      const c = await query(`SELECT 1 FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [clientId, branchFilter]);
      if (c.rows.length === 0) return forbidden(res, 'Client not found in your branch context');
    }

    const { client, rows } = await buildClientStatementRows({
      clientId,
      from,
      to,
      branchFilter,
      includePaid: effectiveIncludePaid,
    });

    if (!client) return notFound(res, 'Client not found');
    if (rows.length === 0) return badRequest(res, 'No invoices found for this client in the selected period');

    const clientName = safeText((client as any).company_name, 120) || 'Client';

    // FIX: Avoid weird arrow rendering (→ became !')
    const periodLabel = `${from} to ${to}`;

    const branchText = branchFilter
      ? `Branch: ${safeText(await getBranchLabel(branchFilter), 80) || ''}`
      : 'Branch: ALL';

    const pdf = await renderStatementPdfBuffer({
      clientName,
      periodLabel,
      branchText,
      rows,
      unpaidOnly: !effectiveIncludePaid,
    });

    const filename = `statement_${clientName.replace(/\s+/g, '_')}_${from}_to_${to}.pdf`;

    return res.json({
      success: true,
      data: {
        filename,
        pdf_base64: pdf.toString('base64'),
      },
    });
  } catch (error: any) {
    console.error('Client statement error', { code: error?.code, message: error?.message });
    return serverError(res);
  }
});

// Direct binary endpoint (still useful for direct downloads / window.open)
router.get('/client-statement.pdf', async (req: AuthRequest, res: Response) => {
  const branchFilter = await getBranchFilter(req, res);
  if (branchFilter === undefined) return;

  const clientId = String(req.query.client_id || '').trim();
  if (!isUuid(clientId)) return badRequest(res, 'client_id must be a UUID');

  const from = parseISODate(req.query.from);
  const to = parseISODate(req.query.to);
  if (!from || !to) return badRequest(res, 'from and to are required (YYYY-MM-DD)');

  const unpaidOnlyRaw = String(req.query.unpaid_only ?? '').trim().toLowerCase();
  const unpaidOnly = unpaidOnlyRaw === '1' || unpaidOnlyRaw === 'true' || unpaidOnlyRaw === 'yes';

  const includePaidRaw = String(req.query.include_paid ?? '').trim().toLowerCase();
  const includePaid = includePaidRaw === '1' || includePaidRaw === 'true' || includePaidRaw === 'yes';

  const effectiveIncludePaid = unpaidOnly ? false : includePaid;

  try {
    if (branchFilter) {
      const c = await query(`SELECT 1 FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [clientId, branchFilter]);
      if (c.rows.length === 0) return forbidden(res, 'Client not found in your branch context');
    }

    const { client, rows } = await buildClientStatementRows({
      clientId,
      from,
      to,
      branchFilter,
      includePaid: effectiveIncludePaid,
    });

    if (!client) return notFound(res, 'Client not found');
    if (rows.length === 0) return badRequest(res, 'No invoices found for this client in the selected period');

    const clientName = safeText((client as any).company_name, 120) || 'Client';
    const periodLabel = `${from} to ${to}`;

    const branchText = branchFilter
      ? `Branch: ${safeText(await getBranchLabel(branchFilter), 80) || ''}`
      : 'Branch: ALL';

    const pdf = await renderStatementPdfBuffer({
      clientName,
      periodLabel,
      branchText,
      rows,
      unpaidOnly: !effectiveIncludePaid,
    });

    const filename = `statement_${clientName.replace(/\s+/g, '_')}_${from}_to_${to}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    return res.send(pdf);
  } catch (error: any) {
    console.error('Client statement PDF error', { code: error?.code, message: error?.message });
    if (!res.headersSent) return serverError(res);
    try {
      res.end();
    } catch {}
  }
});

// Backward/forward compatibility aliases (in case any frontend code calls these)
router.get('/client-statement/base64', (req, res) => (router as any).handle({ ...req, url: '/client-statement' }, res));
router.get('/client-statement/pdf', (req, res) => (router as any).handle({ ...req, url: '/client-statement.pdf' }, res));

export default router;
