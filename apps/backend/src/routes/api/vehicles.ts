// apps/backend/src/routes/api/vehicles.ts
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

function normalizePlate(v: unknown): string {
  const s = normalizeText(v, 50).toUpperCase();
  const collapsed = s.replace(/\s+/g, ' ').trim();
  const safe = collapsed.replace(/[^A-Z0-9 \-]/g, '').trim();
  return safe;
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

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

const VEHICLE_COLUMNS = `
  id,
  client_id,
  license_plate,
  vehicle_type,
  make,
  model,
  year,
  tare_weight,
  max_capacity,
  notes,
  is_active,
  created_at,
  updated_at
`;

// ---- branch helpers (consistent with transactions.ts) ----
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

// WRITE: admin may set ?branch_id; manager/operator forced to own
async function getScopedBranchIdForWrite(req: AuthRequest, res: Response): Promise<string | null> {
  const userId = req.user?.id;
  const role = req.user?.role;

  if (!userId || !role) {
    forbidden(res, 'Unauthorized');
    return null;
  }

  const requestedBranch = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';
  if (requestedBranch) {
    if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), null;
    if (role !== 'admin') return forbidden(res, 'You cannot switch branch context'), null;
    return requestedBranch;
  }

  const own = await resolveUserBranchId(userId);
  if (own) return own;

  if (role === 'admin') return badRequest(res, 'branch_id is required for admin without a branch assignment'), null;

  return forbidden(res, 'User is not assigned to any branch'), null;
}

/**
 * GET /api/vehicles?client_id=...&q=RAD&limit=20
 */
router.get(
  '/',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    // For read, we just need user’s own branch unless admin explicitly switches
    const branchId = await getScopedBranchIdForWrite(req, res);
    if (!branchId) return;

    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id.trim() : '';
    if (!clientId) return badRequest(res, 'client_id is required');
    if (!isUuid(clientId)) return badRequest(res, 'client_id must be a UUID');

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limitRaw = parseIntStrict(req.query.limit);
    const limit = limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 100) : 20;

    try {
      const c = await query(`SELECT id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [clientId, branchId]);
      if (c.rows.length === 0) return notFound(res, 'Client not found for this branch');

      const params: any[] = [clientId, limit];
      let where = `v.client_id = $1 AND v.is_active = true`;

      if (q) {
        params.splice(1, 0, `%${q.toUpperCase()}%`);
        where += ` AND (
          UPPER(v.license_plate) LIKE $2
          OR UPPER(v.vehicle_type) LIKE $2
          OR UPPER(COALESCE(v.make,'')) LIKE $2
          OR UPPER(COALESCE(v.model,'')) LIKE $2
        )`;
      }

      const sql = `
        SELECT ${VEHICLE_COLUMNS}
        FROM vehicles v
        WHERE ${where}
        ORDER BY v.license_plate ASC
        LIMIT $${q ? 3 : 2}
      `;

      const r = await query(sql, params);
      return res.json({ success: true, data: r.rows });
    } catch (error: any) {
      console.error('List vehicles error', { code: error?.code, message: error?.message });
      return serverError(res);
    }
  }
);

/**
 * POST /api/vehicles
 */
router.post(
  '/',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    const branchId = await getScopedBranchIdForWrite(req, res);
    if (!branchId) return;

    const client_id = normalizeText(req.body?.client_id, 80);
    const license_plate = normalizePlate(req.body?.license_plate);
    const vehicle_type = normalizeText(req.body?.vehicle_type, 40).toLowerCase();

    const make = normalizeText(req.body?.make, 80);
    const model = normalizeText(req.body?.model, 80);
    const year = parseIntStrict(req.body?.year);
    const tare_weight = parseNumberStrict(req.body?.tare_weight);
    const max_capacity = parseNumberStrict(req.body?.max_capacity);
    const notes = normalizeText(req.body?.notes, 2000);

    if (!client_id) return badRequest(res, 'client_id is required');
    if (!isUuid(client_id)) return badRequest(res, 'client_id must be a UUID');

    if (!license_plate) return badRequest(res, 'license_plate is required');
    if (!vehicle_type) return badRequest(res, 'vehicle_type is required');

    if (year !== null && (year < 1900 || year > 2100)) return badRequest(res, 'year is out of range');
    if (tare_weight !== null && tare_weight < 0) return badRequest(res, 'tare_weight must be >= 0');
    if (max_capacity !== null && max_capacity < 0) return badRequest(res, 'max_capacity must be >= 0');

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      const c = await db.query(`SELECT id FROM clients WHERE id = $1 AND branch_id = $2 LIMIT 1`, [client_id, branchId]);
      if (c.rows.length === 0) {
        await db.query('ROLLBACK');
        return notFound(res, 'Client not found for this branch');
      }

      try {
        const ins = await db.query(
          `
          INSERT INTO vehicles
            (client_id, license_plate, vehicle_type, make, model, year, tare_weight, max_capacity, notes, is_active, created_at, updated_at)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),NOW())
          RETURNING ${VEHICLE_COLUMNS}
          `,
          [client_id, license_plate, vehicle_type, make || null, model || null, year, tare_weight, max_capacity, notes || null]
        );

        await db.query('COMMIT');
        return res.status(201).json({ success: true, data: ins.rows[0] });
      } catch (e: any) {
        if (e?.code === '23505') {
          await db.query('ROLLBACK');
          return res.status(409).json({ success: false, error: 'A vehicle with this license plate already exists' });
        }
        throw e;
      }
    } catch (error: any) {
      try {
        await db.query('ROLLBACK');
      } catch {}
      console.error('Create vehicle error', { code: error?.code, message: error?.message });
      return serverError(res);
    } finally {
      db.release();
    }
  }
);

export default router;
