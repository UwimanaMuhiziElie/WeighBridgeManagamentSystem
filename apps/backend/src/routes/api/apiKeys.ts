// apps/backend/src/routes/api/apiKeys.ts
import { Router, Response } from 'express';
import crypto from 'crypto';
import net from 'net';
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

function parseIntStrict(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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

// STRICT: if provided, every item must be allowed.
function normalizePermissions(perms: unknown): { perms: string[]; provided: boolean; invalidProvided: boolean } {
  const provided = perms !== undefined && perms !== null;

  if (!provided) return { perms: ['*'], provided: false, invalidProvided: false };
  if (!Array.isArray(perms)) return { perms: [], provided: true, invalidProvided: true };

  const raw = perms.map((p) => (typeof p === 'string' ? p.trim() : ''));
  if (raw.some((p) => !p || !ALLOWED_PERMISSIONS.has(p))) {
    return { perms: [], provided: true, invalidProvided: true };
  }

  const uniq = Array.from(new Set(raw));
  const finalPerms = uniq.includes('*') ? ['*'] : uniq;

  return { perms: finalPerms, provided: true, invalidProvided: false };
}

function makeRawKey(): string {
  return `wbk_${crypto.randomBytes(32).toString('hex')}`;
}

function sha256Hex(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function isValidIpOrCidr(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (net.isIP(s)) return true;

  const parts = s.split('/');
  if (parts.length !== 2) return false;
  const ip = parts[0].trim();
  const prefixRaw = parts[1].trim();

  const family = net.isIP(ip);
  if (!family) return false;

  if (!/^\d+$/.test(prefixRaw)) return false;
  const prefix = Number(prefixRaw);

  if (!Number.isFinite(prefix)) return false;
  if (family === 4) return prefix >= 0 && prefix <= 32;
  if (family === 6) return prefix >= 0 && prefix <= 128;
  return false;
}

function normalizeIpWhitelist(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;

  const clean = v
    .map((x) => normalizeText(x, 80))
    .map((x) => x.trim())
    .filter(Boolean)
    .filter(isValidIpOrCidr);

  const uniq = Array.from(new Set(clean));
  if (uniq.length === 0) return null;
  if (uniq.length > 50) return uniq.slice(0, 50);
  return uniq;
}

async function ensureBranchExists(branchId: string): Promise<boolean> {
  const r = await query(`SELECT id FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
  return r.rows.length > 0;
}

// ----- branch scoping -----
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

async function getBranchFilterForList(req: AuthRequest, res: Response): Promise<string | null | undefined> {
  const userId = req.user?.id;
  const role = req.user?.role;

  if (!userId || !role) {
    forbidden(res, 'Unauthorized');
    return undefined;
  }

  const requestedBranch = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';
  if (requestedBranch) {
    if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), undefined;

    if (role === 'admin') return requestedBranch;

    const own = await resolveUserBranchId(userId);
    if (!own) return forbidden(res, 'Manager is not assigned to any branch'), undefined;
    if (own !== requestedBranch) return forbidden(res, 'Managers cannot switch branch context'), undefined;
    return own;
  }

  if (role === 'admin') return null;

  const own = await resolveUserBranchId(userId);
  if (!own) return forbidden(res, 'Manager is not assigned to any branch'), undefined;
  return own;
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

    if (role === 'admin') return requestedBranch;

    const own = await resolveUserBranchId(userId);
    if (!own) return forbidden(res, 'Manager is not assigned to any branch'), null;
    if (own !== requestedBranch) return forbidden(res, 'Managers cannot switch branch context'), null;
    return own;
  }

  // admin compat fallback: allow body.branch_id
  if (role === 'admin') {
    const bodyBid = normalizeText(req.body?.branch_id, 80);
    if (bodyBid) {
      if (!isUuid(bodyBid)) return badRequest(res, 'branch_id must be a UUID'), null;
      return bodyBid;
    }
  } else {
    if (req.body?.branch_id !== undefined) {
      return badRequest(res, 'branch_id must not be provided in request body'), null;
    }
  }

  const own = await resolveUserBranchId(userId);
  if (own) return own;

  if (role === 'admin') return badRequest(res, 'branch_id is required for admin without a branch assignment'), null;
  return forbidden(res, 'Manager is not assigned to any branch'), null;
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
 * GET /api/api-keys?branch_id=...&limit=200
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const branchFilter = await getBranchFilterForList(req, res);
    if (branchFilter === undefined) return;

    const limitRaw = parseIntStrict(req.query.limit);
    const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 200) : 200;

    const result = await query(
      `SELECT ${SAFE_COLUMNS}
       FROM api_keys
       WHERE ($1::uuid IS NULL OR branch_id = $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [branchFilter, limit]
    );

    return res.json({ success: true, data: result.rows });
  } catch (e: any) {
    console.error('Get api keys error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

/**
 * GET /api/api-keys/audit?limit=200
 */
router.get('/audit', async (req: AuthRequest, res: Response) => {
  try {
    const limitRaw = parseIntStrict(req.query.limit);
    const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    const branchFilter = await getBranchFilterForList(req, res);
    if (branchFilter === undefined) return;

    const result = await query(
      `SELECT id, api_key_id, endpoint, method, status_code, ip_address, duration_ms, created_at
       FROM api_audit_logs
       WHERE ($1::uuid IS NULL OR branch_id = $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [branchFilter, limit]
    );

    return res.json({ success: true, data: result.rows });
  } catch (e: any) {
    console.error('Get audit logs error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

/**
 * POST /api/api-keys
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const name = normalizeText(req.body?.name, 120);
    if (!name || name.length < 2) return badRequest(res, 'name is required');

    const branch_id = await getScopedBranchId(req, res);
    if (!branch_id) return;

    if (!(await ensureBranchExists(branch_id))) return badRequest(res, 'branch_id does not exist');

    const perm = normalizePermissions(req.body?.permissions);
    if (perm.invalidProvided) return badRequest(res, 'Invalid permissions');
    const permissions = perm.perms;

    const rateRaw = req.body?.rate_limit === undefined ? 60 : parseIntStrict(req.body?.rate_limit);
    if (rateRaw === null) return badRequest(res, 'rate_limit must be an integer');
    const rate_limit = rateRaw;

    if (!Number.isFinite(rate_limit) || rate_limit < 1 || rate_limit > 10000) {
      return badRequest(res, 'rate_limit must be between 1 and 10000');
    }

    const ip_whitelist = normalizeIpWhitelist(req.body?.ip_whitelist);

    const expRaw =
      req.body?.expires_in_days === null || req.body?.expires_in_days === undefined
        ? null
        : parseIntStrict(req.body.expires_in_days);

    if (req.body?.expires_in_days !== null && req.body?.expires_in_days !== undefined && expRaw === null) {
      return badRequest(res, 'expires_in_days must be an integer (or null)');
    }

    const expires_in_days = expRaw;
    if (
      expires_in_days !== null &&
      (!Number.isFinite(expires_in_days) || expires_in_days < 1 || expires_in_days > 3650)
    ) {
      return badRequest(res, 'expires_in_days must be between 1 and 3650 (or null)');
    }

    const expires_at =
      expires_in_days !== null ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000) : null;

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
    if (e?.code === '23505') return res.status(409).json({ success: false, error: 'Conflict' });
    return serverError(res);
  }
});

/**
 * POST /api/api-keys/:id/rotate
 */
router.post('/:id/rotate', async (req: AuthRequest, res: Response) => {
  const id = normalizeText(req.params.id, 80);
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  try {
    const branchFilter = await getBranchFilterForList(req, res);
    if (branchFilter === undefined) return;

    const raw_key = makeRawKey();
    const key_hash = sha256Hex(raw_key);
    const key_prefix = raw_key.slice(0, 12);

    const updated = await query(
      `UPDATE api_keys
       SET key_hash=$2, key_prefix=$3, rotated_at=NOW(), updated_at=NOW(), is_active=true
       WHERE id=$1
         AND ($4::uuid IS NULL OR branch_id = $4)
       RETURNING ${SAFE_COLUMNS}`,
      [id, key_hash, key_prefix, branchFilter]
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
 */
router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  const id = normalizeText(req.params.id, 80);
  if (!isUuid(id)) return badRequest(res, 'id must be a UUID');

  const is_active = req.body?.is_active;
  if (typeof is_active !== 'boolean') return badRequest(res, 'is_active must be boolean');

  try {
    const branchFilter = await getBranchFilterForList(req, res);
    if (branchFilter === undefined) return;

    const updated = await query(
      `UPDATE api_keys
       SET is_active=$2, updated_at=NOW()
       WHERE id=$1
         AND ($3::uuid IS NULL OR branch_id = $3)
       RETURNING ${SAFE_COLUMNS}`,
      [id, is_active, branchFilter]
    );

    if (updated.rowCount === 0) return notFound(res, 'API key not found');

    return res.json({ success: true, data: updated.rows[0] });
  } catch (e: any) {
    console.error('Update api key status error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

export default router;
