import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.use(requireRole(['admin', 'manager']));

function badRequest(res: Response, message: string) {
  return res.status(400).json({ success: false, error: message });
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

function normalizeText(v: unknown, maxLen = 255): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

const ALLOWED_PERMISSIONS = new Set([
  '*',
  'transactions:read',
  'transactions:write',
  'clients:read',
  'clients:write',
  'invoices:read',
  'attendance:read',
  'attendance:write',
  'webhooks:write',
]);

function normalizePermissions(perms: unknown): string[] {
  const arr = Array.isArray(perms) ? perms : [];
  const clean = arr
    .map(p => normalizeText(p, 80))
    .filter(Boolean)
    .filter(p => ALLOWED_PERMISSIONS.has(p));

  if (clean.includes('*')) return ['*'];
  return clean.length ? Array.from(new Set(clean)) : ['*'];
}

function makeRawKey(): string {
  // Long enough to not be brute forced; prefix helps identify your product
  return `wbk_${crypto.randomBytes(32).toString('hex')}`;
}

function sha256Hex(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const SAFE_COLUMNS = `
  id,
  branch_id,
  name,
  key_prefix,
  permissions,
  rate_limit,
  ip_whitelist,
  is_active,
  last_used_at,
  expires_at,
  created_at,
  updated_at,
  rotated_at
`;

/**
 * GET /api/api-keys
 */
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT ${SAFE_COLUMNS}
       FROM api_keys
       ORDER BY created_at DESC
       LIMIT 200`
    );
    return res.json({ success: true, data: result.rows });
  } catch (e: any) {
    console.error('Get api keys error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

/**
 * POST /api/api-keys
 * body: { name, branch_id, permissions, rate_limit, ip_whitelist, expires_in_days }
 * returns { api_key, raw_key } (raw_key shown once)
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const name = normalizeText(req.body?.name, 120);
    const branch_id = normalizeText(req.body?.branch_id, 80);
    const permissions = normalizePermissions(req.body?.permissions);
    const rate_limit = Number(req.body?.rate_limit ?? 60);
    const ip_whitelist = Array.isArray(req.body?.ip_whitelist)
      ? req.body.ip_whitelist.map((x: any) => normalizeText(x, 80)).filter(Boolean)
      : null;

    const expires_in_days = req.body?.expires_in_days === null || req.body?.expires_in_days === undefined
      ? null
      : Number(req.body.expires_in_days);

    if (!name || name.length < 2) return badRequest(res, 'name is required');
    if (!branch_id || !isUuid(branch_id)) return badRequest(res, 'branch_id must be a UUID');
    if (!Number.isFinite(rate_limit) || rate_limit < 1 || rate_limit > 10000) {
      return badRequest(res, 'rate_limit must be between 1 and 10000');
    }
    if (expires_in_days !== null && (!Number.isFinite(expires_in_days) || expires_in_days < 1 || expires_in_days > 3650)) {
      return badRequest(res, 'expires_in_days must be between 1 and 3650 (or null)');
    }

    const expires_at =
      expires_in_days !== null
        ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
        : null;

    const raw_key = makeRawKey();
    const key_hash = sha256Hex(raw_key);
    const key_prefix = raw_key.slice(0, 12);

    const created_by = req.user?.id ?? null;

    const inserted = await query(
      `INSERT INTO api_keys
        (branch_id, name, key_hash, key_prefix, permissions, rate_limit, ip_whitelist, is_active, expires_at, created_by)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)
       RETURNING ${SAFE_COLUMNS}`,
      [branch_id, name, key_hash, key_prefix, permissions, rate_limit, ip_whitelist, expires_at, created_by]
    );

    return res.status(201).json({
      success: true,
      data: {
        api_key: inserted.rows[0],
        raw_key,
      },
    });
  } catch (e: any) {
    console.error('Create api key error', { code: e?.code, message: e?.message });
    if (e?.code === '23503') return badRequest(res, 'Invalid branch_id');
    if (e?.code === '23505') return res.status(409).json({ success: false, error: 'Conflict' });
    return serverError(res);
  }
});

/**
 * POST /api/api-keys/:id/rotate
 * returns { api_key, raw_key } (raw_key shown once)
 */
router.post('/:id/rotate', async (req: AuthRequest, res: Response) => {
  const id = normalizeText(req.params.id, 80);
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const raw_key = makeRawKey();
    const key_hash = sha256Hex(raw_key);
    const key_prefix = raw_key.slice(0, 12);

    const updated = await query(
      `UPDATE api_keys
       SET key_hash=$2, key_prefix=$3, rotated_at=NOW(), updated_at=NOW(), is_active=true
       WHERE id=$1
       RETURNING ${SAFE_COLUMNS}`,
      [id, key_hash, key_prefix]
    );

    if (updated.rowCount === 0) return notFound(res, 'API key not found');

    return res.json({
      success: true,
      data: {
        api_key: updated.rows[0],
        raw_key,
      },
    });
  } catch (e: any) {
    console.error('Rotate api key error', { code: e?.code, message: e?.message });
    if (e?.code === '23505') return res.status(409).json({ success: false, error: 'Conflict' });
    return serverError(res);
  }
});

/**
 * PATCH /api/api-keys/:id/status
 * body: { is_active: boolean }
 */
router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  const id = normalizeText(req.params.id, 80);
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  const is_active = req.body?.is_active;
  if (typeof is_active !== 'boolean') return badRequest(res, 'is_active must be boolean');

  try {
    const updated = await query(
      `UPDATE api_keys
       SET is_active=$2, updated_at=NOW()
       WHERE id=$1
       RETURNING ${SAFE_COLUMNS}`,
      [id, is_active]
    );

    if (updated.rowCount === 0) return notFound(res, 'API key not found');

    return res.json({ success: true, data: updated.rows[0] });
  } catch (e: any) {
    console.error('Update api key status error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

/**
 * OPTIONAL (for your UI): GET /api/api-keys/audit?limit=200
 * If you don't have audit logs yet, you can skip this route and hide logs in UI.
 */
router.get('/audit', async (req: AuthRequest, res: Response) => {
  try {
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    const result = await query(
      `SELECT id, api_key_id, endpoint, method, status_code, ip_address, duration_ms, created_at
       FROM api_audit_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.json({ success: true, data: result.rows });
  } catch (e: any) {
    console.error('Get audit logs error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

export default router;
