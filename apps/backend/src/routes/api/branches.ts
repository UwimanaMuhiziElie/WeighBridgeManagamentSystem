import { Router } from 'express';
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
  // Basic validation (enough for UI + DB). Real email validation is more complex.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function isValidCode(code: string) {
  // Keep it strict to avoid messy codes in prod
  // Example: BR01, KGL-02, RW_01
  return /^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code);
}

function safeServerError(res: any) {
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

function handlePgError(res: any, e: any, fallbackMsg: string) {
  // Do NOT leak raw DB errors to clients in production
  if (e?.code === '23505') {
    return res.status(409).json({ success: false, error: 'Branch code already exists' });
  }
  // invalid text representation (e.g., bad uuid)
  if (e?.code === '22P02') {
    return res.status(400).json({ success: false, error: 'Invalid input' });
  }
  // foreign key violation (not likely here, but good hygiene)
  if (e?.code === '23503') {
    return res.status(409).json({ success: false, error: 'Conflict' });
  }

  console.error(fallbackMsg, {
    code: e?.code,
    message: e?.message,
  });

  return safeServerError(res);
}

/**
 * GET /api/branches
 */
router.get('/', async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, name, code, address, phone, email, is_active, created_at, updated_at
       FROM branches
       ORDER BY created_at DESC`
    );

    return res.json({ success: true, data: result.rows });
  } catch (e: any) {
    console.error('Failed to load branches', { code: e?.code, message: e?.message });
    return safeServerError(res);
  }
});

/**
 * POST /api/branches
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};

    const name = String(body.name || '').trim();
    const code = normalizeCode(String(body.code || ''));
    const address = String(body.address || '').trim();
    const phone = String(body.phone || '').trim();
    const email = String(body.email || '').trim();
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
    if (phone && phone.length > 80) {
      return res.status(400).json({ success: false, error: 'phone too long' });
    }
    if (address.length > 500) {
      return res.status(400).json({ success: false, error: 'address too long' });
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
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !isUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid branch id' });
    }

    const body = req.body || {};
    const name = String(body.name || '').trim();
    const code = normalizeCode(String(body.code || ''));
    const address = String(body.address || '').trim();
    const phone = String(body.phone || '').trim();
    const email = String(body.email || '').trim();
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
    if (phone && phone.length > 80) {
      return res.status(400).json({ success: false, error: 'phone too long' });
    }
    if (address.length > 500) {
      return res.status(400).json({ success: false, error: 'address too long' });
    }

    const result = await query(
      `UPDATE branches
       SET name=$2, code=$3, address=$4, phone=$5, email=$6, is_active=$7, updated_at=NOW()
       WHERE id=$1
       RETURNING id, name, code, address, phone, email, is_active, created_at, updated_at`,
      [id, name, code, address, phone, email, is_active]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    return handlePgError(res, e, 'Failed to update branch');
  }
});

/**
 * PATCH /api/branches/:id/status
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
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

export default router;
