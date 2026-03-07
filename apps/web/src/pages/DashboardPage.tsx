import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Users, FileText, AlertTriangle, RefreshCcw, Download } from 'lucide-react';
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
  company_name?: string;
};

type ClientRow = {
  id: string;
  company_name?: string;
  is_active?: boolean;
};

function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function money(v: unknown) {
  return num(v, 0).toFixed(2);
}

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp.error) return String(resp.error);
  if (resp.success === false) return String(resp.error || resp.message || 'Request failed');
  if (resp?.data?.success === false) return String(resp?.data?.error || resp?.data?.message || 'Request failed');
  return null;
}

function unwrapArray<T>(resp: any): T[] {
  const root = resp?.data ?? resp;

  const arr = Array.isArray(root)
    ? root
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.rows)
        ? root.rows
        : Array.isArray(root?.data?.rows)
          ? root.data.rows
          : Array.isArray(root?.data?.data)
            ? root.data.data
            : [];

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

export default function DashboardPage() {
  const navigate = useNavigate();
  const mountedRef = useRef(true);

  const { user, profile } = useAuth();
  const { branchId } = useBranch();

  const role = (user?.role || (profile as any)?.role || 'operator') as Role;
  const isAdmin = role === 'admin';

  // Only admin applies branch filter via query param
  const adminBranchFilter = isAdmin && branchId ? String(branchId) : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

  const totals = useMemo(() => {
    const clientCount = clients.length;

    const invoiceCount = invoices.length;
    const outstanding = invoices.reduce((sum, inv) => sum + num(inv.balance, 0), 0);
    const paid = invoices.reduce((sum, inv) => sum + num(inv.paid_amount, 0), 0);
    const total = invoices.reduce((sum, inv) => sum + num(inv.total_amount, 0), 0);

    const overdueCount = invoices.filter((inv) => String(inv.status || '').toLowerCase() === 'overdue').length;
    const unpaidCount = invoices.filter((inv) => {
      const s = String(inv.status || '').toLowerCase();
      return s === 'unpaid' || s === 'partial' || s === 'pending';
    }).length;

    return { clientCount, invoiceCount, outstanding, paid, total, overdueCount, unpaidCount };
  }, [clients, invoices]);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);

    try {
      const clientsUrl = withQuery('/api/clients', {
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const invoicesUrl = withQuery('/api/invoices', {
        limit: '20',
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const [clientsResp, invoicesResp] = await Promise.all([
        apiClient.get<any>(clientsUrl),
        apiClient.get<any>(invoicesUrl),
      ]);

      if (!mountedRef.current) return;

      const cErr = pickErrorMessage(clientsResp);
      if (cErr) throw new Error(cErr);

      const iErr = pickErrorMessage(invoicesResp);
      if (iErr) throw new Error(iErr);

      setClients(unwrapArray<ClientRow>(clientsResp));
      setInvoices(unwrapArray<InvoiceRow>(invoicesResp));
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Failed to load dashboard data');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [adminBranchFilter]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  async function downloadInvoicePdf(invoiceId: string, invoiceNumber?: string) {
    setError('');

    const resp = await apiClient.getBlob(`/api/invoices/${invoiceId}/pdf`);
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
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
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

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">Clients</div>
            <Users className="w-5 h-5 text-gray-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{loading ? '—' : totals.clientCount}</div>
          <button type="button" onClick={() => navigate('/clients')} className="mt-3 text-sm text-blue-700 hover:text-blue-800">
            View client analytics →
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">Invoices (recent)</div>
            <FileText className="w-5 h-5 text-gray-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{loading ? '—' : totals.invoiceCount}</div>
          <div className="mt-2 text-xs text-gray-500">
            Unpaid: {loading ? '—' : totals.unpaidCount} • Overdue: {loading ? '—' : totals.overdueCount}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">Outstanding Balance</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{loading ? '—' : `$${money(totals.outstanding)}`}</div>
          <div className="mt-2 text-xs text-gray-500">From recent invoices</div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">Paid (recent)</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{loading ? '—' : `$${money(totals.paid)}`}</div>
          <div className="mt-2 text-xs text-gray-500">Total billed: {loading ? '—' : `$${money(totals.total)}`}</div>
        </div>
      </div>

      {/* Recent invoices */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-gray-900">Recent Invoices</div>
            <div className="text-sm text-gray-500">Last {Math.min(invoices.length, 20)} invoices</div>
          </div>
          <button type="button" onClick={() => navigate('/reports')} className="text-sm text-blue-700 hover:text-blue-800">
            Reports →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Invoice</th>
                <th className="text-left font-medium px-6 py-3">Client</th>
                <th className="text-left font-medium px-6 py-3">Status</th>
                <th className="text-right font-medium px-6 py-3">Total</th>
                <th className="text-right font-medium px-6 py-3">Balance</th>
                <th className="text-right font-medium px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {!loading && invoices.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={6}>
                    No invoices found.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 6 }) : invoices.slice(0, 10)).map((inv: any, idx: number) => {
                const isSkeleton = loading;
                const invoiceId = String(inv?.id || `sk-${idx}`);
                const invoiceNumber = String(inv?.invoice_number || '');
                const clientName = String(inv?.company_name || '');
                const status = String(inv?.status || '').toLowerCase();

                return (
                  <tr key={invoiceId}>
                    <td className="px-6 py-4">
                      {isSkeleton ? (
                        <div className="h-4 w-28 bg-gray-100 rounded" />
                      ) : (
                        <div className="font-medium text-gray-900">{invoiceNumber || invoiceId}</div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isSkeleton ? <div className="h-4 w-40 bg-gray-100 rounded" /> : <div className="text-gray-700">{clientName || '—'}</div>}
                    </td>

                    <td className="px-6 py-4">
                      {isSkeleton ? (
                        <div className="h-4 w-20 bg-gray-100 rounded" />
                      ) : (
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            status === 'paid'
                              ? 'bg-green-50 text-green-700'
                              : status === 'overdue'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-yellow-50 text-yellow-700'
                          }`}
                        >
                          {status || 'unknown'}
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSkeleton ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <span className="text-gray-900">${money(inv?.total_amount)}</span>}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSkeleton ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <span className="text-gray-900">${money(inv?.balance)}</span>}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSkeleton ? (
                        <div className="h-8 w-20 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => void downloadInvoicePdf(String(inv?.id), invoiceNumber)}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
                        >
                          <Download className="w-4 h-4" />
                          PDF
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
