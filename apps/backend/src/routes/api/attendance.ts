// apps/backend/src/routes/api/attendance.ts
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

function normalizeNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isISODate(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function parseIsoDateTime(v: unknown): Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return null;

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function resolveUserBranchId(userId: string): Promise<string | null> {
  // 1) users.branch_id
  try {
    const r1 = await query(`SELECT branch_id FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r1.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  // 2) user_profiles.id == users.id  (most consistent with your other modules)
  try {
    const r2 = await query(`SELECT branch_id FROM user_profiles WHERE id = $1 LIMIT 1`, [userId]);
    const bid = r2.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  // 3) legacy fallback if schema has user_id
  try {
    const r3 = await query(`SELECT branch_id FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    const bid = r3.rows?.[0]?.branch_id;
    if (typeof bid === 'string' && isUuid(bid)) return bid;
  } catch {}

  return null;
}

/**
 * Branch scoping:
 * - admin: can use ?branch_id=...; else uses own assignment; if none => must pass branch_id
 * - manager/operator: forced to own branch; ?branch_id allowed only if matches own
 */
async function getScopedBranchId(req: AuthRequest, res: Response): Promise<string | null> {
  const userId = req.user?.id;
  const role = req.user?.role;

  if (!userId || !role) {
    forbidden(res, 'Unauthorized');
    return null;
  }

  const requestedBranch = typeof req.query.branch_id === 'string' ? req.query.branch_id.trim() : '';
  const own = await resolveUserBranchId(userId);

  if (role === 'admin') {
    if (requestedBranch) {
      if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), null;
      return requestedBranch;
    }
    if (own) return own;
    return badRequest(res, 'branch_id is required for admin without a branch assignment'), null;
  }

  // manager/operator
  if (!own) return forbidden(res, 'User is not assigned to any branch'), null;

  if (requestedBranch) {
    if (!isUuid(requestedBranch)) return badRequest(res, 'Invalid branch_id'), null;
    if (requestedBranch !== own) return forbidden(res, 'You cannot switch branch context'), null;
  }

  return own;
}

async function getOperatorInfo(operatorId: string): Promise<{ id: string; full_name: string; role: string; branch_id: string | null } | null> {
  const r = await query(
    `SELECT id, full_name, role, branch_id
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [operatorId]
  );
  if (r.rows.length === 0) return null;

  const row = r.rows[0];
  const branch_id = typeof row.branch_id === 'string' && isUuid(row.branch_id) ? row.branch_id : null;
  return { id: row.id, full_name: row.full_name, role: row.role, branch_id };
}

/**
 * POST /api/attendance
 */
router.post(
  '/',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    const branchId = await getScopedBranchId(req, res);
    if (!branchId) return;

    const role = req.user!.role;

    const date = normalizeText(req.body?.date, 20);
    const hours_worked = normalizeNumber(req.body?.hours_worked);

    const shift_start = parseIsoDateTime(req.body?.shift_start);
    const shift_end = parseIsoDateTime(req.body?.shift_end);

    const notes = normalizeText(req.body?.notes, 2000);

    if (!date || !isISODate(date)) return badRequest(res, 'date must be YYYY-MM-DD');

    if (hours_worked === null || hours_worked < 0 || hours_worked > 24) {
      return badRequest(res, 'hours_worked must be a number between 0 and 24');
    }

    if ((req.body?.shift_start && !shift_start) || (req.body?.shift_end && !shift_end)) {
      return badRequest(res, 'shift_start/shift_end must be valid ISO datetime strings');
    }
    if (shift_start && shift_end && shift_end.getTime() < shift_start.getTime()) {
      return badRequest(res, 'shift_end must be after shift_start');
    }

    const bodyOperatorId = normalizeText(req.body?.operator_id, 80);
    const operator_id = role === 'operator' ? req.user!.id : (bodyOperatorId || '');
    if (!operator_id) return badRequest(res, 'operator_id is required');
    if (!isUuid(operator_id)) return badRequest(res, 'operator_id must be a UUID');

    try {
      const operator = await getOperatorInfo(operator_id);
      if (!operator) return notFound(res, 'Operator not found');
      if (operator.role !== 'operator') return badRequest(res, 'attendance can only be recorded for users with role=operator');

      // Enforce operator belongs to same branchId
      const opBranch = operator.branch_id ?? (await resolveUserBranchId(operator_id));
      if (!opBranch) return badRequest(res, 'Operator has no branch assignment');
      if (opBranch !== branchId) return forbidden(res, 'Operator does not belong to this branch');

      const txCountRes = await query(
        `SELECT COUNT(*)::int as count
         FROM transactions
         WHERE branch_id = $1
           AND operator_id = $2
           AND created_at >= $3::date
           AND created_at < ($3::date + INTERVAL '1 day')`,
        [branchId, operator_id, date]
      );

      const transactions_processed = Number(txCountRes.rows?.[0]?.count || 0);

      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');

        const saved = await dbClient.query(
          `INSERT INTO attendance_records
           (branch_id, operator_id, date, hours_worked, shift_start, shift_end, transactions_processed, notes, recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
           ON CONFLICT (branch_id, operator_id, date)
           DO UPDATE SET
             hours_worked = EXCLUDED.hours_worked,
             shift_start = EXCLUDED.shift_start,
             shift_end = EXCLUDED.shift_end,
             transactions_processed = EXCLUDED.transactions_processed,
             notes = EXCLUDED.notes,
             recorded_at = NOW()
           RETURNING id, branch_id, operator_id, date, hours_worked, shift_start, shift_end, transactions_processed, notes, recorded_at`,
          [branchId, operator_id, date, hours_worked, shift_start, shift_end, transactions_processed, notes]
        );

        await dbClient.query('COMMIT');

        return res.status(201).json({
          success: true,
          message: 'Attendance recorded successfully',
          data: { ...saved.rows[0], operator_name: operator.full_name },
        });
      } catch (e: any) {
        try { await dbClient.query('ROLLBACK'); } catch {}
        console.error('Attendance upsert error', { code: e?.code, message: e?.message });
        return serverError(res);
      } finally {
        dbClient.release();
      }
    } catch (error: any) {
      console.error('Record attendance error', { code: error?.code, message: error?.message });
      return serverError(res);
    }
  }
);

/**
 * GET /api/attendance?operator_id=&date_from=&date_to=&limit=
 */
router.get(
  '/',
  requireRole(['operator', 'admin', 'manager']),
  async (req: AuthRequest, res: Response) => {
    const branchId = await getScopedBranchId(req, res);
    if (!branchId) return;

    const role = req.user!.role;

    const operator_id_q = typeof req.query.operator_id === 'string' ? normalizeText(req.query.operator_id, 80) : '';
    const date_from = typeof req.query.date_from === 'string' ? normalizeText(req.query.date_from, 20) : '';
    const date_to = typeof req.query.date_to === 'string' ? normalizeText(req.query.date_to, 20) : '';

    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 200;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 200;

    if (operator_id_q && !isUuid(operator_id_q)) return badRequest(res, 'operator_id must be a UUID');
    if (date_from && !isISODate(date_from)) return badRequest(res, 'date_from must be YYYY-MM-DD');
    if (date_to && !isISODate(date_to)) return badRequest(res, 'date_to must be YYYY-MM-DD');

    const effectiveOperatorId = role === 'operator' ? req.user!.id : operator_id_q;

    try {
      let q = `
        SELECT
          a.id, a.branch_id, a.operator_id, u.full_name as operator_name,
          a.date, a.hours_worked, a.shift_start, a.shift_end,
          a.transactions_processed, a.notes, a.recorded_at
        FROM attendance_records a
        LEFT JOIN users u ON a.operator_id = u.id
        WHERE a.branch_id = $1
      `;
      const params: any[] = [branchId];
      let idx = 1;

      if (effectiveOperatorId) {
        idx++;
        q += ` AND a.operator_id = $${idx}`;
        params.push(effectiveOperatorId);
      }
      if (date_from) {
        idx++;
        q += ` AND a.date >= $${idx}::date`;
        params.push(date_from);
      }
      if (date_to) {
        idx++;
        q += ` AND a.date <= $${idx}::date`;
        params.push(date_to);
      }

      idx++;
      q += ` ORDER BY a.date DESC LIMIT $${idx}`;
      params.push(limit);

      const result = await query(q, params);
      return res.json({ success: true, data: result.rows });
    } catch (error: any) {
      console.error('Get attendance error', { code: error?.code, message: error?.message });
      return serverError(res);
    }
  }
);

export default router;
