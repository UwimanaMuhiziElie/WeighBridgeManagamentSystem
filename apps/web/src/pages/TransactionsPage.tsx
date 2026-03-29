import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Search, RefreshCcw, AlertTriangle, Eye, X, Calendar, Filter, BarChart3 } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useBranch } from '../contexts/BranchContext';

type Role = 'operator' | 'admin' | 'manager';

type TxRow = {
  id: string;
  transaction_number?: string;
  status?: string;
  transaction_type?: 'inbound' | 'outbound';

  // branch
  branch_id?: string | null;
  branch_name?: string | null;

  client_id?: string | null;
  vehicle_id?: string | null;
  operator_id?: string | null;

  assigned_truck_id?: number | null;
  truck_side_number?: string | null;
  walk_in_name?: string | null;

  first_weight?: number | string | null;
  first_weight_time?: string | null;
  second_weight?: number | string | null;
  second_weight_time?: string | null;

  net_weight?: number | string | null;

  // for non-weight workflows (e.g., mattresses) if backend adds it later
  unit_count?: number | string | null;
  unit_type?: string | null;

  material_type?: string | null;
  reference_number?: string | null;
  notes?: string | null;
  created_at?: string | null;

  company_name?: string | null;
  license_plate?: string | null;
  vehicle_type?: string | null;

  // pricing (no unit price shown in UI)
  amount_excl_tax?: number | string | null; // subtotal
  gst_amount?: number | string | null;      // GST value
  total_amount?: number | string | null;    // subtotal + GST

  // proof of dumping (names may vary; we support multiple)
  proof_of_dumping?: string | null;
  dumping_proof?: string | null;
  dumping_proof_number?: string | null;
};

type Meta = {
  total: number;
  completed: number;
  total_net_weight: number | string;

  // optional (only if backend provides)
  total_amount_excl_tax?: number | string;
  total_gst_amount?: number | string;
  total_amount?: number | string;
};

const GST_RATE = 0.05;

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

function moneyUSD(v: unknown) {
  const n = num(v, NaN as any);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

function weightKg(v: unknown) {
  const n = num(v, NaN as any);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)} kg`;
}

function dt(v: any) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(v);
}

/* -------------------- RESPONSE HELPERS (robust) -------------------- */

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
    Array.isArray(root?.data?.data) ? root.data.data :
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

function withQuery(path: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && String(v).trim() !== '') qs.set(k, String(v));
  });
  const s = qs.toString();
  if (!s) return path;
  return path.includes('?') ? `${path}&${s}` : `${path}?${s}`;
}

function pickBranchName(b: any) {
  return String(b?.name || b?.branch_name || '').trim();
}

function pickFirst<T = any>(obj: any, keys: string[]): T | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v as T;
  }
  return null;
}

export default function TransactionsPage() {
  const navigate = useNavigate();
  const mountedRef = useRef(true);

  const { user, profile } = useAuth();
  const { branchId, setBranchId, branches, loadingBranches, isBranchLocked } = useBranch();

  const role = (user?.role || (profile as any)?.role || 'operator') as Role;
  const isAdmin = role === 'admin';
  const canViewMoney = role === 'admin' || role === 'manager';

  // Admin-only list filter: optional branch_id
  const adminBranchFilter = isAdmin && branchId ? String(branchId) : '';
  const showBranchCol = isAdmin && !adminBranchFilter; // show branch column only when admin viewing "All branches"

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [rows, setRows] = useState<TxRow[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, completed: 0, total_net_weight: 0 });

  // filters
  const [from, setFrom] = useState(() => todayInput());
  const [to, setTo] = useState(() => todayInput());
  const [status, setStatus] = useState<'all' | 'open' | 'pending' | 'in_progress' | 'completed' | 'cancelled'>('open');
  const [q, setQ] = useState('');

  // paging
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  // details drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<TxRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const branchLabel = useMemo(() => {
    const b = branches.find((x: any) => String(x?.id) === String(branchId));
    const name = pickBranchName(b);
    if (!isAdmin) return name || String(branchId || '—');
    if (!branchId) return 'All branches';
    return name || String(branchId);
  }, [isAdmin, branchId, branches]);

  const colCount = 8 + (showBranchCol ? 1 : 0) + (canViewMoney ? 1 : 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    if (from && to && from > to) {
      setError('"From" date cannot be after "To" date.');
      setLoading(false);
      return;
    }

    try {
      const url = withQuery('/api/transactions', {
        limit: String(limit),
        offset: String(offset),
        from: from || undefined,
        to: to || undefined,
        status: status || undefined,
        q: q.trim() || undefined,
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.get<any>(url);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) throw new Error(err);

      const list = unwrapArray<TxRow>(resp);
      const metaRow: any =
        (resp as any)?.data?.meta ??
        (resp as any)?.meta ??
        (resp as any)?.data?.data?.meta ??
        undefined;

      setRows(Array.isArray(list) ? list : []);
      setMeta({
        total: Number(metaRow?.total ?? (resp as any)?.data?.total ?? 0),
        completed: Number(metaRow?.completed ?? 0),
        total_net_weight: metaRow?.total_net_weight ?? 0,

        total_amount_excl_tax: metaRow?.total_amount_excl_tax,
        total_gst_amount: metaRow?.total_gst_amount,
        total_amount: metaRow?.total_amount,
      });
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Failed to load transactions');
      setRows([]);
      setMeta({ total: 0, completed: 0, total_net_weight: 0 });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [from, to, status, q, limit, offset, adminBranchFilter]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  async function openDetails(txId: string) {
    setError('');
    setDrawerOpen(true);
    setDetailLoading(true);
    setSelected(null);

    try {
      const url = withQuery(`/api/transactions/${txId}`, {
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.get<any>(url);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) throw new Error(err);

      const row = unwrapObject<TxRow>(resp);
      setSelected(row);
    } catch (e: any) {
      setError(e?.message || 'Failed to load transaction');
      setSelected(null);
      setDrawerOpen(false);
    } finally {
      if (mountedRef.current) setDetailLoading(false);
    }
  }

  const canPrev = offset > 0;
  const canNext = offset + limit < (meta?.total ?? 0);

  const pickRowBranchLabel = (r: any) => {
    const id = String(r?.branch_id || '');
    const name = String(r?.branch_name || '').trim();
    if (name) return name;
    const b = branches.find((x: any) => String(x?.id) === id);
    return pickBranchName(b) || id || '—';
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Truck className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Transactions</h1>
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

          {/* keep invoices link; backend decides who can see what */}
          <button
            type="button"
            onClick={() => navigate('/invoices')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            View Invoices →
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-1">
            <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> From
            </div>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setOffset(0);
                setFrom(e.target.value);
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>

          <div className="md:col-span-1">
            <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> To
            </div>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setOffset(0);
                setTo(e.target.value);
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>

          <div className="md:col-span-1">
            <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
              <Filter className="w-4 h-4" /> Status
            </div>
            <select
              value={status}
              onChange={(e) => {
                setOffset(0);
                setStatus(e.target.value as any);
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="open">Open (pending + in_progress)</option>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
              <Search className="w-4 h-4" /> Search
            </div>
            <input
              value={q}
              onChange={(e) => {
                setOffset(0);
                setQ(e.target.value);
              }}
              placeholder="TXN number, client, plate, assigned truck id, reference…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>

          <div className="md:col-span-1">
            <div className="text-sm text-gray-600 mb-1">Branch</div>
            {isAdmin ? (
              <select
                value={String(branchId || '')}
                onChange={(e) => {
                  setOffset(0);
                  setBranchId(e.target.value);
                }}
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
                value={branchLabel}
                readOnly
                className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-gray-50 text-gray-700"
                title={isBranchLocked ? 'Branch locked by role' : ''}
              />
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
            <BarChart3 className="w-4 h-4" />
            Total: <span className="font-semibold text-gray-900">{loading ? '—' : meta.total}</span> • Completed:{' '}
            <span className="font-semibold text-gray-900">{loading ? '—' : meta.completed}</span> • Net weight:{' '}
            <span className="font-semibold text-gray-900">{loading ? '—' : weightKg(meta.total_net_weight)}</span>

            {/* optional money aggregates (if backend provides) */}
            {canViewMoney && (meta.total_amount_excl_tax != null || meta.total_amount != null) && (
              <>
                {' '}• Amount:{' '}
                <span className="font-semibold text-gray-900">
                  {meta.total_amount != null ? moneyUSD(meta.total_amount) : moneyUSD(meta.total_amount_excl_tax)}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="text-sm text-gray-600">Rows</div>
            <select
              value={String(limit)}
              onChange={(e) => {
                setOffset(0);
                setLimit(Number(e.target.value));
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Created</th>
                {showBranchCol && <th className="text-left font-medium px-6 py-3">Branch</th>}
                <th className="text-left font-medium px-6 py-3">Transaction</th>
                <th className="text-left font-medium px-6 py-3">Client</th>
                <th className="text-left font-medium px-6 py-3">Plate</th>
                <th className="text-left font-medium px-6 py-3">Assigned Truck ID</th>
                <th className="text-left font-medium px-6 py-3">Status</th>
                <th className="text-right font-medium px-6 py-3">Net</th>
                {canViewMoney && <th className="text-right font-medium px-6 py-3">Total (incl GST)</th>}
                <th className="text-right font-medium px-6 py-3">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-gray-500">
                    No transactions found.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 8 }) : rows).map((r: any, idx: number) => {
                const isSk = loading;
                const id = String(r?.id || `sk-${idx}`);
                const statusTxt = String(r?.status || '').toLowerCase();

                // totals (no unit price shown)
                const total = r?.total_amount ?? r?.total ?? r?.total_price ?? null;

                return (
                  <tr key={id} className={!isSk ? 'hover:bg-gray-50' : ''}>
                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-24 bg-gray-100 rounded" />
                      ) : (
                        <div className="text-gray-600">{r?.created_at ? dt(r.created_at) : '—'}</div>
                      )}
                    </td>

                    {showBranchCol && (
                      <td className="px-6 py-4">
                        {isSk ? <div className="h-4 w-24 bg-gray-100 rounded" /> : <div className="text-gray-700">{pickRowBranchLabel(r)}</div>}
                      </td>
                    )}

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-40 bg-gray-100 rounded" />
                      ) : (
                        <div className="font-medium text-gray-900">{r?.transaction_number || '—'}</div>
                      )}
                      {!isSk && (
                        <div className="text-xs text-gray-500">
                          {String(r?.transaction_type || '').toUpperCase()} • {r?.material_type ? String(r.material_type) : '—'}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-36 bg-gray-100 rounded" />
                      ) : (
                        <div className="text-gray-700">
                          {r?.company_name || (r?.walk_in_name ? `WALK-IN: ${r.walk_in_name}` : 'WALK-IN')}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-20 bg-gray-100 rounded" /> : <div className="text-gray-700">{r?.license_plate || '—'}</div>}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-16 bg-gray-100 rounded" /> : <div className="text-gray-900">{r?.assigned_truck_id ?? '—'}</div>}
                      {!isSk && r?.truck_side_number ? <div className="text-xs text-gray-500">Side: {r.truck_side_number}</div> : null}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-20 bg-gray-100 rounded" />
                      ) : (
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            statusTxt === 'completed'
                              ? 'bg-green-50 text-green-700'
                              : statusTxt === 'cancelled'
                                ? 'bg-gray-100 text-gray-700'
                                : statusTxt === 'in_progress'
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'bg-yellow-50 text-yellow-700'
                          }`}
                        >
                          {statusTxt || 'unknown'}
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? (
                        <div className="h-4 w-20 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <div className="text-gray-900">{r?.net_weight != null ? weightKg(r.net_weight) : '—'}</div>
                      )}
                      {!isSk && (
                        <div className="text-xs text-gray-500">
                          In: {r?.first_weight != null ? weightKg(r.first_weight) : '—'} • Out: {r?.second_weight != null ? weightKg(r.second_weight) : '—'}
                        </div>
                      )}
                    </td>

                    {canViewMoney && (
                      <td className="px-6 py-4 text-right">
                        {isSk ? <div className="h-4 w-20 bg-gray-100 rounded ml-auto" /> : <div className="text-gray-900">{moneyUSD(total)}</div>}
                      </td>
                    )}

                    <td className="px-6 py-4 text-right">
                      {isSk ? (
                        <div className="h-8 w-24 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => void openDetails(String(r?.id))}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
                        >
                          <Eye className="w-4 h-4" />
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing <span className="font-medium text-gray-900">{meta.total ? offset + 1 : 0}</span>–
            <span className="font-medium text-gray-900">{Math.min(offset + limit, meta.total || 0)}</span> of{' '}
            <span className="font-medium text-gray-900">{meta.total || 0}</span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canPrev || loading}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!canNext || loading}
              onClick={() => setOffset((o) => o + limit)}
              className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Details Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl flex flex-col">
            <div className="p-5 border-b border-gray-200 flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold text-gray-900">Transaction Details</div>
                <div className="text-xs text-gray-500">
                  {adminBranchFilter ? `Filtered branch: ${adminBranchFilter}` : branchLabel}
                </div>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="p-2 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-700" />
              </button>
            </div>

            <div className="p-5 overflow-auto">
              {detailLoading && (
                <div className="space-y-3">
                  <div className="h-5 w-64 bg-gray-100 rounded" />
                  <div className="h-4 w-full bg-gray-100 rounded" />
                  <div className="h-4 w-5/6 bg-gray-100 rounded" />
                  <div className="h-4 w-4/6 bg-gray-100 rounded" />
                </div>
              )}

              {!detailLoading && selected && (
                <div className="space-y-4">
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                    <div className="text-sm text-gray-600">Transaction #</div>
                    <div className="text-xl font-bold text-gray-900">{selected.transaction_number || selected.id}</div>
                    <div className="mt-2 text-sm text-gray-700">
                      Status: <span className="font-medium">{String(selected.status || '—')}</span> • Type:{' '}
                      <span className="font-medium">{String(selected.transaction_type || '—')}</span>
                    </div>
                    {showBranchCol && (
                      <div className="mt-1 text-sm text-gray-700">
                        Branch: <span className="font-medium">{pickRowBranchLabel(selected)}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="text-sm text-gray-600">Client</div>
                      <div className="text-gray-900 font-medium">
                        {selected.company_name || (selected.walk_in_name ? `WALK-IN: ${selected.walk_in_name}` : 'WALK-IN')}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Plate: {selected.license_plate || '—'}</div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="text-sm text-gray-600">Truck</div>
                      <div className="text-gray-900 font-medium">Assigned ID: {selected.assigned_truck_id ?? '—'}</div>
                      <div className="text-xs text-gray-500 mt-1">Side: {selected.truck_side_number || '—'}</div>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="text-sm text-gray-600 mb-2">Weights</div>
                    <div className="text-sm text-gray-900">
                      Scale-In:{' '}
                      <span className="font-medium">{selected.first_weight != null ? weightKg(selected.first_weight) : '—'}</span>
                      {selected.first_weight_time ? <span className="text-gray-500"> ({dt(selected.first_weight_time)})</span> : null}
                    </div>
                    <div className="text-sm text-gray-900">
                      Scale-Out:{' '}
                      <span className="font-medium">{selected.second_weight != null ? weightKg(selected.second_weight) : '—'}</span>
                      {selected.second_weight_time ? <span className="text-gray-500"> ({dt(selected.second_weight_time)})</span> : null}
                    </div>
                    <div className="text-sm text-gray-900 mt-2">
                      Net: <span className="font-semibold">{selected.net_weight != null ? weightKg(selected.net_weight) : '—'}</span>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="text-sm text-gray-600">Material / Reference</div>
                    <div className="text-gray-900">Material: {selected.material_type || '—'}</div>
                    <div className="text-gray-900">Reference: {selected.reference_number || '—'}</div>

                    {/* Proof of dumping */}
                    <div className="text-gray-900">
                      Proof of dumping:{' '}
                      {pickFirst<string>(selected, ['proof_of_dumping', 'dumping_proof', 'dumping_proof_number']) || '—'}
                    </div>

                    {selected.notes ? <div className="text-sm text-gray-700 mt-2">Notes: {selected.notes}</div> : null}
                  </div>

                  {/* Pricing block (NO unit price shown) */}
                  {canViewMoney && (
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="text-sm text-gray-600 mb-2">Pricing</div>

                      {(() => {
                        const subtotalRaw = pickFirst<any>(selected, ['amount_excl_tax', 'subtotal', 'amount']);
                        const gstRaw = pickFirst<any>(selected, ['gst_amount', 'tax_amount', 'gst', 'tax']);
                        const totalRaw = pickFirst<any>(selected, ['total_amount', 'total', 'total_price', 'grand_total']);

                        const subtotal = subtotalRaw != null ? num(subtotalRaw, NaN as any) : NaN;
                        const gst = gstRaw != null ? num(gstRaw, NaN as any) : (Number.isFinite(subtotal) ? +(subtotal * GST_RATE).toFixed(2) : NaN);
                        const total = totalRaw != null ? num(totalRaw, NaN as any) : (Number.isFinite(subtotal) ? +(subtotal + (Number.isFinite(gst) ? gst : 0)).toFixed(2) : NaN);

                        return (
                          <div className="grid grid-cols-3 gap-3">
                            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                              <div className="text-xs text-gray-500">Amount</div>
                              <div className="text-sm font-semibold text-gray-900 mt-1">{moneyUSD(subtotal)}</div>
                            </div>
                            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                              <div className="text-xs text-gray-500">GST (5%)</div>
                              <div className="text-sm font-semibold text-gray-900 mt-1">{moneyUSD(gst)}</div>
                            </div>
                            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                              <div className="text-xs text-gray-500">Total</div>
                              <div className="text-sm font-semibold text-gray-900 mt-1">{moneyUSD(total)}</div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
                      onClick={() => setDrawerOpen(false)}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                      onClick={() => navigate('/invoices')}
                    >
                      Go to invoices →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
