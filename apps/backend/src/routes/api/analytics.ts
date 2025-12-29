import { Router, Response } from 'express';
import { query } from '../../db.js';
import { authenticate, AuthRequest } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);

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

function parseISODate(s: any): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
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
 * GET /api/analytics/clients?from=YYYY-MM-DD&to=YYYY-MM-DD&branch_id(optional, admin/manager only)
 * operator is forced to own branch_id.
 */
router.get('/clients', async (req: AuthRequest, res: Response) => {
  try {
    const from = parseISODate(req.query.from) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = parseISODate(req.query.to) || new Date().toISOString().slice(0, 10);

    const role = req.user?.role;
    const myBranch = req.user?.branch_id ?? null;

    const requestedBranch = typeof req.query.branch_id === 'string' && req.query.branch_id.trim()
      ? req.query.branch_id.trim()
      : null;

    let branch_id: string | null = null;

    if (role === 'operator') {
      if (!myBranch) return forbidden(res, 'Operator has no branch assigned');
      branch_id = String(myBranch);
    } else {
      // admin/manager can switch branch or view all
      if (requestedBranch) {
        if (!isUuid(requestedBranch)) return badRequest(res, 'branch_id must be UUID');
        branch_id = requestedBranch;
      } else {
        branch_id = null;
      }
    }

    const invAmountCol = await pickExistingColumn('invoices', ['amount', 'total_amount', 'grand_total', 'total']);
    const invClientCol = await pickExistingColumn('invoices', ['client_id']);
    const invStatusCol = await pickExistingColumn('invoices', ['status', 'payment_status']);
    const invIsPaidCol = await pickExistingColumn('invoices', ['is_paid']);
    const invDueCol = await pickExistingColumn('invoices', ['due_date', 'due_at']);
    const clientNameCol = await pickExistingColumn('clients', ['name', 'full_name', 'company_name']);

    if (!invClientCol) {
      return res.json({
        success: true,
        data: {
          range: { from, to, branch_id },
          top_clients: [],
          repeat_clients: { count: 0 },
          invoice_aging: [],
        },
      });
    }

    const invValueExpr = invAmountCol ? `COALESCE(SUM(i.${qIdent(invAmountCol)}),0)::numeric` : `NULL::numeric`;

    const params: any[] = [from, to];
    let branchFilter = '';
    if (branch_id) {
      params.push(branch_id);
      branchFilter = ` AND i.branch_id = $${params.length}`;
    }

    // top clients
    const top = await query(
      `SELECT i.${qIdent(invClientCol)}::text AS client_id,
              c.${clientNameCol ? qIdent(clientNameCol) : '"id"'}::text AS client_name,
              COUNT(*)::int AS invoices,
              ${invValueExpr} AS total_value
       FROM invoices i
       LEFT JOIN clients c ON c.id::text = i.${qIdent(invClientCol)}::text
       WHERE i.created_at::date >= $1::date AND i.created_at::date <= $2::date
       ${branchFilter}
       GROUP BY client_id, client_name
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
         WHERE i.created_at::date >= $1::date AND i.created_at::date <= $2::date
         ${branchFilter}
         GROUP BY client_id
         HAVING COUNT(*) >= 2
       ) x`,
      params
    );

    // unpaid aging
    let unpaidWhere = '';
    if (invIsPaidCol) unpaidWhere = ` AND i.${qIdent(invIsPaidCol)} = false`;
    else if (invStatusCol) unpaidWhere = ` AND LOWER(i.${qIdent(invStatusCol)}) <> 'paid'`;

    const dateCol = invDueCol ? `i.${qIdent(invDueCol)}` : `i.created_at`;
    const agingValueExpr = invAmountCol ? `COALESCE(SUM(i.${qIdent(invAmountCol)}),0)::numeric` : `NULL::numeric`;

    const aging = await query(
      `SELECT
        CASE
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 0 AND 30 THEN '0-30'
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 31 AND 60 THEN '31-60'
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 61 AND 90 THEN '61-90'
          ELSE '90+'
        END AS bucket,
        COUNT(*)::int AS count,
        ${agingValueExpr} AS value
       FROM invoices i
       WHERE i.created_at::date >= $1::date AND i.created_at::date <= $2::date
       ${branchFilter}
       ${unpaidWhere}
       GROUP BY bucket
       ORDER BY
        CASE bucket
          WHEN '0-30' THEN 1
          WHEN '31-60' THEN 2
          WHEN '61-90' THEN 3
          ELSE 4
        END`,
      params
    );

    return res.json({
      success: true,
      data: {
        range: { from, to, branch_id },
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
