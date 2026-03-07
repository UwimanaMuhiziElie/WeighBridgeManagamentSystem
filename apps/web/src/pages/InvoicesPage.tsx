import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, RefreshCcw, AlertTriangle, Download, Eye, XCircle, Search, Calendar } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useBranch } from '../contexts/BranchContext';

type Role = 'operator' | 'admin' | 'manager';

type InvoiceRow = {
  id: string;
  invoice_number?: string;
  invoice_date?: string;
  status?: string;

  total_amount?: number | string;
  paid_amount?: number | string;
  balance?: number | string;

  created_at?: string;

  company_name?: string | null;

  assigned_truck_id?: number | null;
  truck_side_number?: string | null;
  transaction_number?: string | null;

  // branch (optional; if backend sends)
  branch_id?: string | null;
  branch_name?: string | null;
};

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

function toISODate(v: any): string | null {
  if (!v) return null;
  // If it's already yyyy-mm-dd, keep it
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function InvoicesPage() {
  const navigate = useNavigate();
  const mountedRef = useRef(true);

  const { user, profile } = useAuth();
  const { branchId, setBranchId, branches, loadingBranches, isBranchLocked } = useBranch();

  const role = (user?.role || (profile as any)?.role || 'operator') as Role;
  const isAdmin = role === 'admin';
  const isAdminOrManager = role === 'admin' || role === 'manager';

  // Admin-only list filter: optional branch_id
  const adminBranchFilter = isAdmin && branchId ? String(branchId) : '';
  const showBranchCol = isAdmin && !adminBranchFilter; // show branch only when admin viewing "All branches"

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);

  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'sent' | 'overdue' | 'paid' | 'cancelled'>('all');
  const [q, setQ] = useState('');

  // optional date filters (safe even if backend ignores)
  const [from, setFrom] = useState(() => '');
  const [to, setTo] = useState(() => '');

  const branchLabel = useMemo(() => {
    if (!isAdmin) {
      const b = branches.find((x: any) => String(x?.id) === String(branchId));
      return pickBranchName(b) || String(branchId || '—');
    }
    if (!branchId) return 'All branches';
    const b = branches.find((x: any) => String(x?.id) === String(branchId));
    return pickBranchName(b) || String(branchId);
  }, [isAdmin, branchId, branches]);

  const pickRowBranchLabel = useCallback(
    (r: any) => {
      const id = String(r?.branch_id || '');
      const name = String(r?.branch_name || '').trim();
      if (name) return name;
      const b = branches.find((x: any) => String(x?.id) === id);
      return pickBranchName(b) || id || '—';
    },
    [branches]
  );

  const colCount = 8 + (showBranchCol ? 1 : 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    if (from && to && from > to) {
      setError('"From" date cannot be after "To" date.');
      setLoading(false);
      return;
    }

    try {
      const url = withQuery('/api/invoices', {
        limit: String(limit),
        offset: String(offset),
        status: statusFilter !== 'all' ? statusFilter : undefined,
        q: q.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.get<any>(url);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) throw new Error(err);

      const list = unwrapArray<InvoiceRow>(resp);
      setRows(Array.isArray(list) ? list : []);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Failed to load invoices');
      setRows([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [limit, offset, adminBranchFilter, statusFilter, q, from, to]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  async function downloadPdf(invoiceId: string, invoiceNumber?: string) {
    setError('');

    try {
      const urlPath = withQuery(`/api/invoices/${invoiceId}/pdf`, {
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.getBlob(urlPath);

      const err = pickErrorMessage(resp);
      if (err) {
        setError(err);
        return;
      }

      const blob = (resp as any)?.data;
      if (!(blob instanceof Blob)) {
        setError('PDF download failed: invalid response type.');
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${invoiceNumber || invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'PDF download failed.');
    }
  }

  async function cancelInvoice(invoiceId: string) {
    if (!isAdminOrManager) return;

    const reasonInput = window.prompt('Cancel invoice reason (optional):', '');
    if (reasonInput === null) return; // user pressed cancel
    const reason = String(reasonInput || '').trim();

    setError('');

    try {
      const url = withQuery(`/api/invoices/${invoiceId}/cancel`, {
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.patch<any>(url, { reason });

      const err = pickErrorMessage(resp);
      if (err) {
        setError(err);
        return;
      }

      // refresh list after cancel (safer than patching row shape differences)
      void load();
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel invoice');
    }
  }

  // Client-side filter remains (in case backend ignores q/status/date)
  const filtered = useMemo(() => {
    const qx = q.trim().toLowerCase();

    return rows.filter((r) => {
      const st = String(r.status || '').toLowerCase();
      if (statusFilter !== 'all' && st !== statusFilter) return false;

      const invDateISO = toISODate(r.invoice_date) || toISODate(r.created_at);
      if (from && invDateISO && invDateISO < from) return false;
      if (to && invDateISO && invDateISO > to) return false;

      if (!qx) return true;

      const hay = [
        r.invoice_number,
        r.company_name,
        r.transaction_number,
        r.assigned_truck_id != null ? String(r.assigned_truck_id) : '',
        r.truck_side_number,
        r.branch_name,
        r.branch_id,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' | ');

      return hay.includes(qx);
    });
  }, [rows, statusFilter, q, from, to]);

  const totals = useMemo(() => {
    // lightweight page totals (based on filtered rows)
    const totalAmount = filtered.reduce((acc, r) => acc + num(r.total_amount, 0), 0);
    const totalBalance = filtered.reduce((acc, r) => acc + num(r.balance, 0), 0);
    return { totalAmount, totalBalance };
  }, [filtered]);

  const canPrev = offset > 0;
  const canNext = !loading && rows.length >= limit; // backend paging hint

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
          disabled={loading}
        >
          <RefreshCcw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {/* Controls */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          <div className="md:col-span-2">
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

          <div>
            <div className="text-sm text-gray-600 mb-1">Status</div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setOffset(0);
                setStatusFilter(e.target.value as any);
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
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
              placeholder={todayInput()}
            />
          </div>

          <div>
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
              placeholder={todayInput()}
            />
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
              placeholder="Invoice #, client, TXN #, truck id, side…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">Rows</div>
            <select
              value={String(limit)}
              onChange={(e) => {
                setOffset(0);
                setLimit(Number(e.target.value));
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>
        </div>

        <div className="mt-3 text-sm text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
          <div>
            Showing <span className="font-medium text-gray-900">{filtered.length}</span> invoice(s) (loaded {rows.length})
          </div>
          <div>
            Total: <span className="font-medium text-gray-900">{moneyUSD(totals.totalAmount)}</span>
          </div>
          <div>
            Balance: <span className="font-medium text-gray-900">{moneyUSD(totals.totalBalance)}</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Invoice</th>
                {showBranchCol && <th className="text-left font-medium px-6 py-3">Branch</th>}
                <th className="text-left font-medium px-6 py-3">Client</th>
                <th className="text-left font-medium px-6 py-3">Transaction</th>
                <th className="text-left font-medium px-6 py-3">Truck</th>
                <th className="text-left font-medium px-6 py-3">Status</th>
                <th className="text-right font-medium px-6 py-3">Total</th>
                <th className="text-right font-medium px-6 py-3">Balance</th>
                <th className="text-right font-medium px-6 py-3">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-gray-500">
                    No invoices found.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 8 }) : filtered).map((inv: any, idx: number) => {
                const isSk = loading;
                const id = String(inv?.id || `sk-${idx}`);
                const statusTxt = String(inv?.status || '').toLowerCase();
                const canCancel = isAdminOrManager && statusTxt !== 'paid' && statusTxt !== 'cancelled';

                return (
                  <tr key={id} className={!isSk ? 'hover:bg-gray-50' : ''}>
                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-28 bg-gray-100 rounded" />
                      ) : (
                        <div className="font-medium text-gray-900">{inv?.invoice_number || inv?.id}</div>
                      )}
                      {!isSk && (
                        <div className="text-xs text-gray-500">
                          {inv?.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : inv?.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}
                        </div>
                      )}
                    </td>

                    {showBranchCol && (
                      <td className="px-6 py-4">
                        {isSk ? <div className="h-4 w-28 bg-gray-100 rounded" /> : <div className="text-gray-700">{pickRowBranchLabel(inv)}</div>}
                      </td>
                    )}

                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-40 bg-gray-100 rounded" /> : <div className="text-gray-700">{inv?.company_name || '—'}</div>}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-32 bg-gray-100 rounded" /> : <div className="text-gray-700">{inv?.transaction_number || '—'}</div>}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-24 bg-gray-100 rounded" />
                      ) : (
                        <div className="text-gray-700">
                          {inv?.assigned_truck_id != null ? `ID: ${inv.assigned_truck_id}` : '—'}
                          {inv?.truck_side_number ? <span className="text-xs text-gray-500"> • Side: {inv.truck_side_number}</span> : null}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-20 bg-gray-100 rounded" />
                      ) : (
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            statusTxt === 'paid'
                              ? 'bg-green-50 text-green-700'
                              : statusTxt === 'overdue'
                                ? 'bg-red-50 text-red-700'
                                : statusTxt === 'cancelled'
                                  ? 'bg-gray-100 text-gray-700'
                                  : 'bg-yellow-50 text-yellow-700'
                          }`}
                        >
                          {statusTxt || 'unknown'}
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <span className="text-gray-900">{moneyUSD(inv?.total_amount)}</span>}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <span className="text-gray-900">{moneyUSD(inv?.balance)}</span>}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? (
                        <div className="h-8 w-28 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/invoices/${inv.id}`)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
                          >
                            <Eye className="w-4 h-4" />
                            View
                          </button>

                          <button
                            type="button"
                            onClick={() => void downloadPdf(String(inv.id), String(inv.invoice_number || ''))}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
                          >
                            <Download className="w-4 h-4" />
                            PDF
                          </button>

                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => void cancelInvoice(String(inv.id))}
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
                            >
                              <XCircle className="w-4 h-4" />
                              Cancel
                            </button>
                          )}
                        </div>
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
            Showing offset <span className="font-medium text-gray-900">{offset}</span> • loaded{' '}
            <span className="font-medium text-gray-900">{rows.length}</span>
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
              disabled={!canNext}
              onClick={() => setOffset((o) => o + limit)}
              className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
              title="Loads next page (backend supports offset/limit)"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
