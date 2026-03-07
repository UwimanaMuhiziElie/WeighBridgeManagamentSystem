// apps/backend/src/routes/api/analytics.ts
import { Router, Response } from 'express';
import { query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.use(requireRole(['operator', 'admin', 'manager']));

function badRequest(res: Response, message: string) {
  return res.status(400).json({ success: false, error: message });
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

function parseISODate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function daysBetween(from: string, to: string): number | null {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const da = a.getTime();
  const db = b.getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.floor((db - da) / 86400000);
}

async function pickExistingColumn(table: string, candidates: string[]): Promise<string | null> {
  const cols = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  const set = new Set(cols.rows.map((r: any) => String(r.column_name)));
  for (const c of candidates) {
    if (set.has(c)) return c;
  }
  return null;
}

function qIdent(col: string) {
  if (!/^[a-z0-9_]+$/i.test(col)) throw new Error('Unsafe identifier');
  return `"${col}"`;
}

/**
 * Branch resolution: users.branch_id fallback to user_profiles.branch_id (id == users.id)
 */
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

/**
 * Analytics branch scope:
 * - admin: ALL branches by default; optional ?branch_id=
 * - manager/operator: forced to own branch; cannot switch
 *
 * Returns:
 * - string => filter to that branch
 * - null   => ALL branches (admin)
 * - undefined => response already sent
 */
async function getBranchFilterForAnalytics(req: AuthRequest, res: Response): Promise<string | null | undefined> {
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
    if (!own) return forbidden(res, 'User is not assigned to any branch'), undefined;
    if (own !== requestedBranch) return forbidden(res, 'You cannot switch branch context'), undefined;
    return own;
  }

  if (role === 'admin') return null;

  const own = await resolveUserBranchId(userId);
  if (!own) return forbidden(res, 'User is not assigned to any branch'), undefined;
  return own;
}

/**
 * GET /api/analytics/clients?from=YYYY-MM-DD&to=YYYY-MM-DD&branch_id(optional)
 */
router.get('/clients', async (req: AuthRequest, res: Response) => {
  try {
    const from = parseISODate(req.query.from) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = parseISODate(req.query.to) || new Date().toISOString().slice(0, 10);

    if (from > to) return badRequest(res, 'from must be <= to');

    // ✅ safety: prevent very large scans
    const span = daysBetween(from, to);
    if (span === null) return badRequest(res, 'Invalid date range');
    if (span > 366) return badRequest(res, 'Date range too large (max 366 days)');

    const branchFilter = await getBranchFilterForAnalytics(req, res);
    if (branchFilter === undefined) return;

    // Detect invoice + client columns
    const invAmountCol = await pickExistingColumn('invoices', ['amount', 'total_amount', 'grand_total', 'total']);
    const invClientCol = await pickExistingColumn('invoices', ['client_id']);
    const invStatusCol = await pickExistingColumn('invoices', ['status', 'payment_status']);
    const invIsPaidCol = await pickExistingColumn('invoices', ['is_paid']);
    const invDueCol = await pickExistingColumn('invoices', ['due_date', 'due_at']);

    const clientNameCol = await pickExistingColumn('clients', ['name', 'full_name', 'company_name']);

    // Branch scoping support:
    // - Prefer invoices.branch_id
    // - If missing, try join invoices -> transactions to apply t.branch_id
    const invBranchCol = await pickExistingColumn('invoices', ['branch_id']);
    const invTxIdCol = await pickExistingColumn('invoices', ['transaction_id']);
    const invTxNumberCol = await pickExistingColumn('invoices', ['transaction_number', 'transaction_no']);

    // If invoices are not linked to clients, return empty but success
    if (!invClientCol) {
      return res.json({
        success: true,
        data: {
          range: { from, to, branch_id: branchFilter },
          top_clients: [],
          repeat_clients: { count: 0 },
          invoice_aging: [],
        },
      });
    }

    const invValueExpr = invAmountCol ? `COALESCE(SUM(i.${qIdent(invAmountCol)}),0)::numeric` : `NULL::numeric`;

    // Build JOIN + branch filter
    const params: any[] = [from, to];
    let joinTx = '';      // requested by you; injected into queries
    let branchSql = '';   // AND ... = $N

    if (branchFilter) {
      if (invBranchCol) {
        params.push(branchFilter);
        branchSql = ` AND i.${qIdent(invBranchCol)} = $${params.length}`;
      } else {
        // Attempt to scope via transactions join
        const txBranchCol = await pickExistingColumn('transactions', ['branch_id']);
        if (!txBranchCol) return forbidden(res, 'Branch-scoped analytics requires transactions.branch_id');

        if (invTxIdCol) {
          joinTx = `LEFT JOIN transactions t ON t.id::text = i.${qIdent(invTxIdCol)}::text`;
          params.push(branchFilter);
          branchSql = ` AND t.${qIdent(txBranchCol)} = $${params.length}`;
        } else if (invTxNumberCol) {
          const txNumberCol = await pickExistingColumn('transactions', ['transaction_number', 'transaction_no', 'number']);
          if (!txNumberCol) {
            return forbidden(res, 'Branch-scoped analytics requires invoices.branch_id or invoice->transaction link');
          }
          joinTx = `LEFT JOIN transactions t ON t.${qIdent(txNumberCol)}::text = i.${qIdent(invTxNumberCol)}::text`;
          params.push(branchFilter);
          branchSql = ` AND t.${qIdent(txBranchCol)} = $${params.length}`;
        } else {
          return forbidden(res, 'Branch-scoped analytics requires invoices.branch_id or invoices.transaction_id');
        }
      }
    }

    // top clients
    const clientNameExpr = clientNameCol ? `c.${qIdent(clientNameCol)}::text` : `c.id::text`;

    const top = await query(
      `SELECT
        i.${qIdent(invClientCol)}::text AS client_id,
        ${clientNameExpr} AS client_name,
        COUNT(*)::int AS invoices,
        ${invValueExpr} AS total_value
       FROM invoices i
       ${joinTx}
       LEFT JOIN clients c ON c.id::text = i.${qIdent(invClientCol)}::text
       WHERE i.created_at::date >= $1::date AND i.created_at::date <= $2::date
       ${branchSql}
       GROUP BY 1, 2
       ORDER BY total_value DESC NULLS LAST, invoices DESC
       LIMIT 20`,
      params
    );

    // repeat clients: clients with 2+ invoices
    const repeats = await query(
      `SELECT COUNT(*)::int AS count
       FROM (
         SELECT i.${qIdent(invClientCol)}::text AS client_id, COUNT(*)::int AS n
         FROM invoices i
         ${joinTx}
         WHERE i.created_at::date >= $1::date AND i.created_at::date <= $2::date
         ${branchSql}
         GROUP BY 1
         HAVING COUNT(*) >= 2
       ) x`,
      params
    );

    // unpaid filter
    let unpaidWhere = '';
    if (invIsPaidCol) unpaidWhere = ` AND i.${qIdent(invIsPaidCol)} = false`;
    else if (invStatusCol) unpaidWhere = ` AND LOWER(i.${qIdent(invStatusCol)}) <> 'paid'`;

    // If due_date exists but can be NULL, fallback to created_at
    const dateCol = invDueCol ? `COALESCE(i.${qIdent(invDueCol)}, i.created_at)` : `i.created_at`;
    const agingValueExpr = invAmountCol ? `COALESCE(SUM(i.${qIdent(invAmountCol)}),0)::numeric` : `NULL::numeric`;

    // unpaid aging (FIXED)  ✅ includes joinTx as you requested
    // NOTE: We compute bucket_order safely and order by it (no ungrouped-column error)
    const aging = await query(
      `SELECT
        CASE
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 0 AND 30 THEN '0-30'
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 31 AND 60 THEN '31-60'
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 61 AND 90 THEN '61-90'
          ELSE '90+'
        END AS bucket,
        COUNT(*)::int AS count,
        ${agingValueExpr} AS value,
        CASE
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 0 AND 30 THEN 1
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 31 AND 60 THEN 2
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 61 AND 90 THEN 3
          ELSE 4
        END AS bucket_order
       FROM invoices i
       ${joinTx}
       WHERE i.created_at::date >= $1::date AND i.created_at::date <= $2::date
       ${branchSql}
       ${unpaidWhere}
       GROUP BY 1, 4
       ORDER BY 4`,
      params
    );

    return res.json({
      success: true,
      data: {
        range: { from, to, branch_id: branchFilter },
        top_clients: top.rows.map((r: any) => ({
          client_id: String(r.client_id),
          client_name: r.client_name ? String(r.client_name) : null,
          invoices: r.invoices,
          total_value: r.total_value ?? null,
        })),
        repeat_clients: { count: repeats.rows[0]?.count ?? 0 },
        invoice_aging: aging.rows.map((r: any) => ({
          bucket: String(r.bucket),
          count: r.count,
          value: r.value ?? null,
        })),
      },
    });
  } catch (e: any) {
    console.error('Clients analytics error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

export default router;

