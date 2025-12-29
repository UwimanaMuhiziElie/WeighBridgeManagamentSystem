import { Router, Response } from 'express';
import { query } from '../../db.js';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.use(requireRole(['admin', 'manager']));

function badRequest(res: Response, message: string) {
  return res.status(400).json({ success: false, error: message });
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
  // safe identifier quoting: allow only [a-z0-9_]
  if (!/^[a-z0-9_]+$/i.test(col)) throw new Error('Unsafe identifier');
  return `"${col}"`;
}

/**
 * GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&branch_id=uuid(optional)
 */
router.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const from = parseISODate(req.query.from) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = parseISODate(req.query.to) || new Date().toISOString().slice(0, 10);

    const branch_id = typeof req.query.branch_id === 'string' && req.query.branch_id.trim()
      ? req.query.branch_id.trim()
      : null;

    if (branch_id && !isUuid(branch_id)) return badRequest(res, 'branch_id must be UUID');

    // try to adapt to your schema without forcing refactors
    const txAmountCol = await pickExistingColumn('transactions', ['amount', 'total_amount', 'net_amount', 'total']);
    const invAmountCol = await pickExistingColumn('invoices', ['amount', 'total_amount', 'grand_total', 'total']);
    const invStatusCol = await pickExistingColumn('invoices', ['status', 'payment_status']);
    const invIsPaidCol = await pickExistingColumn('invoices', ['is_paid']);
    const invDueCol = await pickExistingColumn('invoices', ['due_date', 'due_at']);
    const txOperatorCol = await pickExistingColumn('transactions', ['operator_id', 'created_by', 'user_id']);

    // Date range bounds
    const paramsBase: any[] = [from, to];
    let branchFilterSql = '';
    if (branch_id) {
      paramsBase.push(branch_id);
      branchFilterSql = ` AND branch_id = $${paramsBase.length}`;
    }

    // Transactions totals
    const txValueExpr = txAmountCol ? `COALESCE(SUM(${qIdent(txAmountCol)}),0)::numeric` : `NULL::numeric`;
    const txDailyValueExpr = txAmountCol ? `COALESCE(SUM(${qIdent(txAmountCol)}),0)::numeric` : `NULL::numeric`;

    const txTotals = await query(
      `SELECT COUNT(*)::int AS total_count,
              ${txValueExpr} AS total_value
       FROM transactions
       WHERE created_at::date >= $1::date AND created_at::date <= $2::date
       ${branchFilterSql}`,
      paramsBase
    );

    const txByDay = await query(
      `SELECT created_at::date AS day,
              COUNT(*)::int AS count,
              ${txDailyValueExpr} AS total_value
       FROM transactions
       WHERE created_at::date >= $1::date AND created_at::date <= $2::date
       ${branchFilterSql}
       GROUP BY created_at::date
       ORDER BY day ASC`,
      paramsBase
    );

    // Invoices totals
    const invValueExpr = invAmountCol ? `COALESCE(SUM(${qIdent(invAmountCol)}),0)::numeric` : `NULL::numeric`;
    const invTotals = await query(
      `SELECT COUNT(*)::int AS total_count,
              ${invValueExpr} AS total_value
       FROM invoices
       WHERE created_at::date >= $1::date AND created_at::date <= $2::date
       ${branchFilterSql}`,
      paramsBase
    );

    // Unpaid logic (best effort)
    let unpaidWhere = '';
    if (invIsPaidCol) unpaidWhere = ` AND ${qIdent(invIsPaidCol)} = false`;
    else if (invStatusCol) unpaidWhere = ` AND LOWER(${qIdent(invStatusCol)}) <> 'paid'`;

    const invUnpaid = await query(
      `SELECT COUNT(*)::int AS unpaid_count,
              ${invValueExpr} AS unpaid_value
       FROM invoices
       WHERE created_at::date >= $1::date AND created_at::date <= $2::date
       ${branchFilterSql}
       ${unpaidWhere}`,
      paramsBase
    );

    // Aging buckets (unpaid, based on due_date if present else created_at)
    const dateCol = invDueCol ? qIdent(invDueCol) : `created_at`;
    const agingValueExpr = invAmountCol ? `COALESCE(SUM(${qIdent(invAmountCol)}),0)::numeric` : `NULL::numeric`;

    const invAging = await query(
      `SELECT
        CASE
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 0 AND 30 THEN '0-30'
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 31 AND 60 THEN '31-60'
          WHEN (CURRENT_DATE - ${dateCol}::date) BETWEEN 61 AND 90 THEN '61-90'
          ELSE '90+'
        END AS bucket,
        COUNT(*)::int AS count,
        ${agingValueExpr} AS value
       FROM invoices
       WHERE created_at::date >= $1::date AND created_at::date <= $2::date
       ${branchFilterSql}
       ${unpaidWhere}
       GROUP BY bucket
       ORDER BY
        CASE bucket
          WHEN '0-30' THEN 1
          WHEN '31-60' THEN 2
          WHEN '61-90' THEN 3
          ELSE 4
        END`,
      paramsBase
    );

    // Operator performance (best effort)
    let operators: any[] = [];
    if (txOperatorCol) {
      const opValueExpr = txAmountCol ? `COALESCE(SUM(t.${qIdent(txAmountCol)}),0)::numeric` : `NULL::numeric`;
      const op = await query(
        `SELECT t.${qIdent(txOperatorCol)}::text AS operator_id,
                u.email AS operator_email,
                COUNT(*)::int AS count,
                ${opValueExpr} AS total_value
         FROM transactions t
         LEFT JOIN users u ON u.id::text = t.${qIdent(txOperatorCol)}::text
         WHERE t.created_at::date >= $1::date AND t.created_at::date <= $2::date
         ${branch_id ? ` AND t.branch_id = $3` : ''}
         GROUP BY operator_id, operator_email
         ORDER BY count DESC
         LIMIT 50`,
        branch_id ? [from, to, branch_id] : [from, to]
      );
      operators = op.rows;
    }

    return res.json({
      success: true,
      data: {
        range: { from, to, branch_id },
        transactions: {
          total_count: txTotals.rows[0]?.total_count ?? 0,
          total_value: txTotals.rows[0]?.total_value ?? null,
          by_day: txByDay.rows.map((r: any) => ({
            day: String(r.day),
            count: r.count,
            total_value: r.total_value ?? null,
          })),
        },
        invoices: {
          total_count: invTotals.rows[0]?.total_count ?? 0,
          total_value: invTotals.rows[0]?.total_value ?? null,
          unpaid_count: invUnpaid.rows[0]?.unpaid_count ?? 0,
          unpaid_value: invUnpaid.rows[0]?.unpaid_value ?? null,
          aging: invAging.rows.map((r: any) => ({
            bucket: String(r.bucket),
            count: r.count,
            value: r.value ?? null,
          })),
        },
        operators,
      },
    });
  } catch (e: any) {
    console.error('Reports summary error', { code: e?.code, message: e?.message });
    return serverError(res);
  }
});

export default router;
