// apps/backend/src/routes/api/branches.ts
import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { query } from '../../db.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

const router = Router();

// Only logged-in users, and only admins/managers can manage branches
router.use(authenticate);
router.use(requireRole(['admin', 'manager']));

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function isValidCode(code: string) {
  // Example: BR01, KGL-02, RW_01
  return /^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code);
}

function normalizeOptionalText(v: unknown, maxLen: number): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeServerError(res: Response) {
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

function handlePgError(res: Response, e: any, fallbackMsg: string) {
  if (e?.code === '23505') {
    return res.status(409).json({ success: false, error: 'Branch code already exists' });
  }
  if (e?.code === '22P02') {
    return res.status(400).json({ success: false, error: 'Invalid input' });
  }
  if (e?.code === '23503') {
    return res.status(409).json({ success: false, error: 'Conflict' });
  }

  console.error(fallbackMsg, { code: e?.code, message: e?.message });
  return safeServerError(res);
}

// --- GST helpers ---
function parseBoolStrict(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return null;
}

function parseNumberStrict(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/branches
 * ✅ includes gst_enabled / gst_rate when migration 011 exists
 * ✅ fallback to old select if columns don't exist yet (42703)
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    try {
      const result = await query(
        `SELECT id, name, code, address, phone, email, is_active, gst_enabled, gst_rate, created_at, updated_at
         FROM branches
         ORDER BY created_at DESC`
      );
      return res.json({ success: true, data: result.rows });
    } catch (e: any) {
      // If migration 011 not applied yet, don't break the app
      if (e?.code === '42703') {
        const result = await query(
          `SELECT id, name, code, address, phone, email, is_active, created_at, updated_at
           FROM branches
           ORDER BY created_at DESC`
        );
        return res.json({ success: true, data: result.rows });
      }
      throw e;
    }
  } catch (e: any) {
    console.error('Failed to load branches', { code: e?.code, message: e?.message });
    return safeServerError(res);
  }
});

/**
 * POST /api/branches
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};

    const name = String(body.name || '').trim();
    const code = normalizeCode(String(body.code || ''));
    const address = normalizeOptionalText(body.address, 500);
    const phone = normalizeOptionalText(body.phone, 80);
    const emailRaw = normalizeOptionalText(body.email, 254);
    const email = emailRaw ? emailRaw.toLowerCase() : null;

    const is_active = typeof body.is_active === 'boolean' ? body.is_active : true;

    if (!name || !code) {
      return res.status(400).json({ success: false, error: 'name and code are required' });
    }
    if (name.length > 120) {
      return res.status(400).json({ success: false, error: 'name too long' });
    }
    if (!isValidCode(code)) {
      return res.status(400).json({
        success: false,
        error: 'code must be 2-20 chars (A-Z, 0-9, _, -) and start with alphanumeric',
      });
    }
    if (email && (!isValidEmail(email) || email.length > 254)) {
      return res.status(400).json({ success: false, error: 'invalid email' });
    }

    const id = crypto.randomUUID();

    const result = await query(
      `INSERT INTO branches (id, name, code, address, phone, email, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, code, address, phone, email, is_active, created_at, updated_at`,
      [id, name, code, address, phone, email, is_active]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    return handlePgError(res, e, 'Failed to create branch');
  }
});

/**
 * PUT /api/branches/:id
 * ✅ patched:
 * - prevents accidental wiping of optional fields if client omits them
 * - empty strings clear to NULL
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || !isUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid branch id' });
    }

    // Load existing to avoid wiping fields on partial PUTs
    const existing = await query(
      `SELECT id, name, code, address, phone, email, is_active
       FROM branches
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }
    const ex = existing.rows[0];

    const body = req.body || {};

    const name = body.name === undefined ? String(ex.name || '').trim() : String(body.name || '').trim();
    const code = body.code === undefined ? normalizeCode(String(ex.code || '')) : normalizeCode(String(body.code || ''));

    const address = body.address === undefined ? (ex.address ?? null) : normalizeOptionalText(body.address, 500);
    const phone = body.phone === undefined ? (ex.phone ?? null) : normalizeOptionalText(body.phone, 80);

    const emailRaw = body.email === undefined ? (ex.email ?? null) : normalizeOptionalText(body.email, 254);
    const email = emailRaw ? String(emailRaw).toLowerCase() : null;

    const is_active = body.is_active === undefined ? !!ex.is_active : !!body.is_active;

    if (!name || !code) {
      return res.status(400).json({ success: false, error: 'name and code are required' });
    }
    if (name.length > 120) {
      return res.status(400).json({ success: false, error: 'name too long' });
    }
    if (!isValidCode(code)) {
      return res.status(400).json({
        success: false,
        error: 'code must be 2-20 chars (A-Z, 0-9, _, -) and start with alphanumeric',
      });
    }
    if (email && (!isValidEmail(email) || email.length > 254)) {
      return res.status(400).json({ success: false, error: 'invalid email' });
    }

    const result = await query(
      `UPDATE branches
       SET name=$2, code=$3, address=$4, phone=$5, email=$6, is_active=$7, updated_at=NOW()
       WHERE id=$1
       RETURNING id, name, code, address, phone, email, is_active, created_at, updated_at`,
      [id, name, code, address, phone, email, is_active]
    );

    return res.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    return handlePgError(res, e, 'Failed to update branch');
  }
});

/**
 * PATCH /api/branches/:id/status
 */
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || !isUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid branch id' });
    }

    const { is_active } = req.body || {};
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_active must be a boolean' });
    }

    const result = await query(
      `UPDATE branches
       SET is_active=$2, updated_at=NOW()
       WHERE id=$1
       RETURNING id, name, code, address, phone, email, is_active, created_at, updated_at`,
      [id, is_active]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    console.error('Failed to update branch status', { code: e?.code, message: e?.message });
    return safeServerError(res);
  }
});

/**
 * PATCH /api/branches/:id/gst
 * ✅ Admin-only: toggle GST and set rate (%)
 *
 * Body examples:
 *  { "gst_enabled": true, "gst_rate": 18 }
 *  { "gst_enabled": false }
 */
router.patch('/:id/gst', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || !isUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid branch id' });
    }

    const body = req.body || {};

    const enabledRaw = (body as any).gst_enabled ?? (body as any).gstEnabled;
    const gst_enabled = parseBoolStrict(enabledRaw);
    if (gst_enabled === null) {
      return res.status(400).json({ success: false, error: 'gst_enabled must be a boolean' });
    }

    const rateRaw = (body as any).gst_rate ?? (body as any).gstRate;
    let gst_rate: number;

    if (gst_enabled) {
      const parsed = rateRaw === undefined ? 18 : parseNumberStrict(rateRaw);
      if (parsed === null) {
        return res.status(400).json({ success: false, error: 'gst_rate must be a number' });
      }
      if (parsed < 0 || parsed > 100) {
        return res.status(400).json({ success: false, error: 'gst_rate must be between 0 and 100' });
      }
      gst_rate = Number(parsed.toFixed(2));
    } else {
      gst_rate = 0;
    }

    const result = await query(
      `
      UPDATE branches
      SET gst_enabled = $2, gst_rate = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, code, gst_enabled, gst_rate, updated_at
      `,
      [id, gst_enabled, gst_rate]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    if (e?.code === '42703') {
      return res.status(409).json({
        success: false,
        error: 'GST columns not found. Apply the GST migration first (gst_enabled + gst_rate on branches).',
      });
    }
    console.error('Failed to update branch GST', { code: e?.code, message: e?.message });
    return safeServerError(res);
  }
});

export default router;
