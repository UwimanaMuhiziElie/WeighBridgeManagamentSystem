// apps/web/src/pages/ClientsAnalyticsPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { Branch } from '@weighbridge/shared';

/* -------------------- PATCH-1 RESPONSE HELPERS -------------------- */

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

function unwrapObject<T = any>(resp: any): T {
  const root = resp?.data ?? resp;
  const obj =
    (root && typeof root === 'object' && 'data' in root && root.data && typeof root.data === 'object')
      ? root.data
      : root;
  return obj as T;
}

function isForbiddenError(msg: string) {
  const m = (msg || '').toLowerCase();
  return m.includes('forbidden') || m.includes('403') || m.includes('request failed (403)');
}

// timezone-safe YYYY-MM-DD for <input type="date">
function toDateInputValue(d: Date) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pickBranchName(b: any) {
  return String(b?.name || b?.branch_name || '').trim();
}
function pickBranchCode(b: any) {
  return String(b?.code || b?.branch_code || '').trim();
}
function branchLabel(b: any) {
  const n = pickBranchName(b);
  const c = pickBranchCode(b);
  if (c && n) return `${c} — ${n}`;
  return n || c || String(b?.id || '');
}

function fmtMoney(v: any) {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type ClientsAnalytics = {
  range: { from: string; to: string; branch_id: string | null };
  top_clients: Array<{ client_id: string; client_name: string | null; invoices: number; total_value: number | null }>;
  repeat_clients: { count: number };
  invoice_aging: Array<{ bucket: string; count: number; value: number | null }>;
};

export default function ClientsAnalyticsPage() {
  const { user } = useAuth();
  const role = user?.role || '';

  // Backend allows operator/admin/manager. UI: allow view for all 3.
  const canView = role === 'operator' || role === 'admin' || role === 'manager';

  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const isAdminOrManager = isAdmin || isManager;

  const myBranchId = String((user as any)?.branch_id || '');

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>(''); // admin-only branch filter

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateInputValue(d);
  });
  const [to, setTo] = useState(() => toDateInputValue(new Date()));

  const [data, setData] = useState<ClientsAnalytics | null>(null);

  const [loading, setLoading] = useState(true); // initial page load
  const [fetching, setFetching] = useState(false); // later Apply/Refresh
  const [pageError, setPageError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void init();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    setLoading(true);
    setPageError('');
    setAccessDenied(false);

    // Load branches only if allowed (admin/manager)
    if (isAdminOrManager) {
      await loadBranches();
    }

    await loadAnalytics();
    if (mountedRef.current) setLoading(false);
  }

  async function loadBranches() {
    try {
      const resp = await apiClient.get('/api/branches');
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) {
        setBranches([]);
        setPageError(err);
        if (isForbiddenError(err)) setAccessDenied(true);
        return;
      }

      setBranches(unwrapArray<Branch>(resp));
    } catch (e: any) {
      if (!mountedRef.current) return;
      const msg = String(e?.message || 'Failed to load branches');
      setBranches([]);
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
    }
  }

  async function loadAnalytics() {
    setPageError('');
    setAccessDenied(false);

    // basic client-side validation (backend also validates)
    if (from && to && from > to) {
      setPageError('"From" date cannot be after "To" date.');
      return;
    }

    setFetching(true);

    try {
      const qs = new URLSearchParams();
      qs.set('from', from);
      qs.set('to', to);

      // backend rule: only admin can switch branch context
      if (isAdmin && selectedBranch) qs.set('branch_id', selectedBranch);

      const resp = await apiClient.get(`/api/analytics/clients?${qs.toString()}`);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) {
        setData(null);
        setPageError(err);
        if (isForbiddenError(err)) setAccessDenied(true);
        return;
      }

      setData(unwrapObject<ClientsAnalytics>(resp));
    } catch (e: any) {
      if (!mountedRef.current) return;
      const msg = String(e?.message || 'Failed to load client analytics');
      setData(null);
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
    } finally {
      if (mountedRef.current) setFetching(false);
    }
  }

  const branchScopeLabel = useMemo(() => {
    if (!canView) return '—';

    // Admin: can choose branch or all
    if (isAdmin) {
      if (!selectedBranch) return 'All branches';
      const b = branches.find((x: any) => String((x as any)?.id) === selectedBranch);
      return branchLabel(b) || selectedBranch;
    }

    // Manager/operator: forced to own branch
    if (isAdminOrManager && myBranchId) {
      const b = branches.find((x: any) => String((x as any)?.id) === myBranchId);
      return branchLabel(b) || 'My branch';
    }
    return 'My branch';
  }, [canView, isAdmin, isAdminOrManager, selectedBranch, branches, myBranchId]);

  if (!canView) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 mt-0.5" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Access Restricted</h1>
              <p className="text-gray-600 mt-1">You don’t have permission to view client analytics.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Client Analytics</h1>
          </div>
          <p className="text-gray-600 mt-1">Top clients, repeats, and invoice aging</p>

          {pageError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div>{pageError}</div>
            </div>
          )}

          {accessDenied && (
            <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
              Your account does not have permission to view analytics.
            </div>
          )}
        </div>

        <button
          onClick={() => void loadAnalytics()}
          disabled={fetching}
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
          {fetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 mb-6 p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>

          {/* Only admin can change branch context. Manager/operator are forced to own branch. */}
          <select
            value={isAdmin ? selectedBranch : ''}
            onChange={(e) => setSelectedBranch(e.target.value)}
            disabled={!isAdmin}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
          >
            {!isAdmin ? (
              <option value="">My branch</option>
            ) : (
              <>
                <option value="">All branches</option>
                {branches.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {branchLabel(b) || b.id}
                  </option>
                ))}
              </>
            )}
          </select>

          <div className="text-xs text-gray-500 mt-1">Current: {branchScopeLabel}</div>
        </div>

        <div className="md:col-span-4 flex justify-end">
          <button
            onClick={() => void loadAnalytics()}
            disabled={fetching}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {fetching ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>

      {!data ? (
        <div className="text-gray-600">No data.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card title="Repeat clients" value={String(data.repeat_clients.count)} sub="Clients with 2+ invoices in range" />
            <Card title="Top clients shown" value={String(data.top_clients.length)} sub="Top revenue clients" />
            <Card title="Aging buckets" value={String(data.invoice_aging.length)} sub="Unpaid aging summary" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Top clients by revenue">
              <SimpleTable
                headers={['Client', 'Invoices', 'Total']}
                rows={data.top_clients.map((x) => [
                  x.client_name || x.client_id,
                  String(x.invoices),
                  x.total_value == null ? '—' : fmtMoney(x.total_value),
                ])}
                empty="No client data"
              />
            </Panel>

            <Panel title="Invoice aging (unpaid)">
              <SimpleTable
                headers={['Bucket', 'Count', 'Value']}
                rows={data.invoice_aging.map((x) => [
                  x.bucket,
                  String(x.count),
                  x.value == null ? '—' : fmtMoney(x.value),
                ])}
                empty="No aging data"
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-3xl font-bold text-gray-900 mt-1">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{sub}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function SimpleTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  if (!rows.length) return <div className="text-gray-600 text-sm">{empty}</div>;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 text-gray-600 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-b-0 border-gray-100">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 text-gray-800">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
