// apps/web/src/pages/ReportsPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, RefreshCcw, AlertTriangle, Download } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useBranch } from '../contexts/BranchContext';

type Role = 'operator' | 'admin' | 'manager';

type TransactionRow = {
  id: string;
  transaction_number?: string;
  status?: string;
  net_weight?: number | string;
  created_at?: string;
  company_name?: string;
  license_plate?: string;

  // optional (if your backend includes them)
  operator_id?: string;
  operator_email?: string;
  created_by?: string;
  created_by_email?: string;

  // optional monetary fields (if present)
  total_value?: number | string;
  total_amount?: number | string;
  amount?: number | string;
};

function isForbiddenError(msg: string) {
  const m = (msg || '').toLowerCase();
  return m.includes('forbidden') || m.includes('403') || m.includes('request failed (403)');
}

// timezone-safe YYYY-MM-DD for <input type="date">
function todayInput() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp?.error) return String(resp.error);
  if (resp?.success === false) return String(resp.error || resp.message || 'Request failed');
  if (resp?.data?.success === false) return String(resp.data.error || resp.data.message || 'Request failed');
  return null;
}

function unwrapArray<T>(resp: any): T[] {
  const root = resp?.data ?? resp;
  const arr =
    Array.isArray(root) ? root :
    Array.isArray(root?.data) ? root.data :
    Array.isArray(root?.rows) ? root.rows :
    Array.isArray(root?.data?.rows) ? root.data.rows :
    [];
  return Array.isArray(arr) ? (arr as T[]) : [];
}

function pickBranchName(b: any) {
  return String(b?.name || b?.branch_name || '').trim();
}

function dayKeyFromCreatedAt(created_at?: string) {
  if (!created_at) return '—';
  const d = new Date(String(created_at));
  if (!Number.isFinite(d.getTime())) return String(created_at).slice(0, 10) || '—';
  // use ISO day (stable)
  return d.toISOString().slice(0, 10);
}

function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(','), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function pickOperatorLabel(t: TransactionRow) {
  return (
    t.operator_email ||
    t.created_by_email ||
    t.operator_id ||
    t.created_by ||
    '—'
  );
}

function pickMoney(t: TransactionRow): number | null {
  // only if your backend provides one of these
  const v =
    t.total_value ?? t.total_amount ?? t.amount;
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
}

export default function ReportsPage() {
  const mountedRef = useRef(true);

  const { user, profile } = useAuth();
  const { branchId, setBranchId, branches, loadingBranches } = useBranch();

  const role = (user?.role || (profile as any)?.role || 'operator') as Role;
  const isAdmin = role === 'admin';

  const [from, setFrom] = useState(() => todayInput());
  const [to, setTo] = useState(() => todayInput());

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [accessDenied, setAccessDenied] = useState(false);

  const [rows, setRows] = useState<TransactionRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setAccessDenied(false);

    if (from && to && from > to) {
      setError('"From" date cannot be after "To" date.');
      setLoading(false);
      return;
    }

    try {
      const qs = new URLSearchParams();
      qs.set('limit', '2000');
      qs.set('from', from);
      qs.set('to', to);

      // backend may ignore status if not supported; safe to send later if you add UI for it
      // qs.set('status', '');

      // IMPORTANT: only admin can switch branch context
      if (isAdmin && branchId) qs.set('branch_id', String(branchId));

      const resp = await apiClient.get<any>(`/api/transactions?${qs.toString()}`);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) {
        setError(err);
        if (isForbiddenError(err)) setAccessDenied(true);
        setRows([]);
        return;
      }

      setRows(unwrapArray<TransactionRow>(resp));
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Failed to load reports');
      setRows([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [from, to, isAdmin, branchId]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const branchLabel = useMemo(() => {
    if (!isAdmin) return String(branchId || '—');
    if (!branchId) return 'All branches';
    const b = branches.find((x: any) => String(x?.id) === String(branchId));
    return pickBranchName(b) || String(branchId);
  }, [isAdmin, branchId, branches]);

  const totals = useMemo(() => {
    const txCount = rows.length;

    const completed = rows.filter((t) => String(t.status || '').toLowerCase() === 'completed').length;

    const totalNet = rows.reduce((sum, t) => sum + num(t.net_weight, 0), 0);

    // optional: total money if your tx rows have it
    const moneyVals = rows.map(pickMoney).filter((x): x is number => x !== null);
    const totalValue = moneyVals.length ? moneyVals.reduce((a, b) => a + b, 0) : null;

    return { txCount, completed, totalNet, totalValue };
  }, [rows]);

  const byDay = useMemo(() => {
    const map = new Map<string, { day: string; count: number; total_value: number | null }>();

    for (const t of rows) {
      const day = dayKeyFromCreatedAt(t.created_at);
      if (!map.has(day)) map.set(day, { day, count: 0, total_value: null });

      const entry = map.get(day)!;
      entry.count += 1;

      const m = pickMoney(t);
      if (m !== null) entry.total_value = (entry.total_value ?? 0) + m;
    }

    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [rows]);

  const operators = useMemo(() => {
    const map = new Map<string, { operator_id: string; operator_email?: string; count: number; total_value: number | null }>();

    for (const t of rows) {
      const label = pickOperatorLabel(t);
      if (!map.has(label)) {
        map.set(label, { operator_id: label, operator_email: label.includes('@') ? label : undefined, count: 0, total_value: null });
      }
      const entry = map.get(label)!;
      entry.count += 1;

      const m = pickMoney(t);
      if (m !== null) entry.total_value = (entry.total_value ?? 0) + m;
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [rows]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
            disabled={loading}
          >
            <RefreshCcw className="w-4 h-4" />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => {
              const out = byDay.map((r) => ({
                day: r.day,
                transactions: r.count,
                total_value: r.total_value === null ? 'N/A' : r.total_value.toFixed(2),
              }));
              downloadCsv(`reports-by-day-${from}-to-${to}.csv`, out);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={loading || !byDay.length}
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {accessDenied && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
          Your account does not have permission to view reports.
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <div className="text-sm text-gray-600 mb-1">From</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">To</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">Branch</div>

            {isAdmin ? (
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white"
                disabled={loadingBranches}
              >
                <option value="">All branches</option>
                {branches.map((b: any) => (
                  <option key={b.id} value={String(b.id)}>
                    {pickBranchName(b) || b.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={branchLabel}
                readOnly
                className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-gray-50 text-gray-700"
              />
            )}
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void load()}
              className="w-full inline-flex justify-center items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              <RefreshCcw className="w-4 h-4" />
              Apply
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Transactions</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{loading ? '—' : totals.txCount}</div>
          <div className="mt-1 text-sm text-gray-600">
            Total net: {loading ? '—' : `${totals.totalNet.toFixed(2)} kg`}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Completed</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{loading ? '—' : totals.completed}</div>
          <div className="mt-1 text-sm text-gray-600">
            Total value: {loading ? '—' : totals.totalValue === null ? 'N/A' : totals.totalValue.toFixed(2)}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Notes</div>
          <div className="mt-2 text-sm text-gray-700">
            {/* This page uses <span className="font-mono">GET /api/transactions</span> (same as Desktop) to avoid the current <span className="font-mono">/api/reports/summary</span> 500. */}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">Transactions by day</div>
          <div className="text-sm text-gray-500">{loading ? 'Loading...' : `${byDay.length} row(s)`}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Day</th>
                <th className="text-right font-medium px-6 py-3">Count</th>
                <th className="text-right font-medium px-6 py-3">Total value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {!loading && !byDay.length && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={3}>
                    No data for selected range.
                  </td>
                </tr>
              )}

              {byDay.map((r) => (
                <tr key={r.day}>
                  <td className="px-6 py-3 text-gray-900">{r.day}</td>
                  <td className="px-6 py-3 text-right text-gray-900">{r.count}</td>
                  <td className="px-6 py-3 text-right text-gray-900">
                    {r.total_value === null ? 'N/A' : r.total_value.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">Operator performance</div>
          <div className="text-sm text-gray-500">{loading ? 'Loading...' : `${operators.length} row(s)`}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Operator</th>
                <th className="text-right font-medium px-6 py-3">Transactions</th>
                <th className="text-right font-medium px-6 py-3">Total value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {!loading && operators.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={3}>
                    No operator data.
                  </td>
                </tr>
              )}

              {operators.map((o, idx) => (
                <tr key={`${o.operator_id}-${idx}`}>
                  <td className="px-6 py-3 text-gray-900">{o.operator_email || o.operator_id}</td>
                  <td className="px-6 py-3 text-right text-gray-900">{o.count}</td>
                  <td className="px-6 py-3 text-right text-gray-900">
                    {o.total_value === null ? 'N/A' : o.total_value.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
