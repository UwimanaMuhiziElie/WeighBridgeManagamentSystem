import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Users, FileText, AlertTriangle, RefreshCcw, Download } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';

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

// Keep same base-url logic as shared apiClient (so web + desktop behave the same)
function getApiBaseUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viteUrl = (import.meta as any)?.env?.VITE_API_URL;
    if (viteUrl) return String(viteUrl);
  } catch {
    // ignore
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeUrl = typeof process !== 'undefined' ? (process as any)?.env?.VITE_API_URL : null;
  if (nodeUrl) return String(nodeUrl);
  return 'http://localhost:3001';
}

async function safeGetArray<T = any>(endpoint: string): Promise<T[]> {
  const resp = await apiClient.get<any>(endpoint);
  if ((resp as any)?.error) throw new Error((resp as any).error);
  const data = (resp as any)?.data ?? resp;

  // Support: { success, data: [...] } OR raw [...]
  const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.rows) ? data.rows : data?.data;
  return Array.isArray(arr) ? (arr as T[]) : [];
}

export default function DashboardPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

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

    return {
      clientCount,
      invoiceCount,
      outstanding,
      paid,
      total,
      overdueCount,
      unpaidCount,
    };
  }, [clients, invoices]);

  async function load() {
    setError('');
    setLoading(true);

    let alive = true;

    try {
      // These endpoints exist in your backend now:
      // - GET /api/clients
      // - GET /api/invoices?limit=...
      const [clientsRows, invoicesRows] = await Promise.all([
        safeGetArray<ClientRow>('/api/clients'),
        safeGetArray<InvoiceRow>('/api/invoices?limit=20'),
      ]);

      if (!alive) return;

      setClients(clientsRows);
      setInvoices(invoicesRows);
    } catch (e: any) {
      setError(e?.message || 'Failed to load dashboard data');
    } finally {
      if (alive) setLoading(false);
    }

    return () => {
      alive = false;
    };
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await load();
      } catch {
        // ignore
      } finally {
        if (cancelled) return;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function downloadInvoicePdf(invoiceId: string, invoiceNumber?: string) {
    const token = apiClient.getToken?.();
    if (!token) {
      setError('Session expired. Please sign in again.');
      return;
    }

    try {
      setError('');

      const resp = await fetch(`${apiBaseUrl}/api/invoices/${invoiceId}/pdf`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!resp.ok) {
        if (resp.status === 401) apiClient.setToken?.(null);
        throw new Error(`Failed to download PDF (${resp.status})`);
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${invoiceNumber || invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'Failed to download invoice PDF');
    }
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
          onClick={() => load()}
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
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {loading ? '—' : totals.clientCount}
          </div>
          <button
            type="button"
            onClick={() => navigate('/clients')}
            className="mt-3 text-sm text-blue-700 hover:text-blue-800"
          >
            View client analytics →
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">Invoices (recent)</div>
            <FileText className="w-5 h-5 text-gray-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {loading ? '—' : totals.invoiceCount}
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Unpaid: {loading ? '—' : totals.unpaidCount} • Overdue: {loading ? '—' : totals.overdueCount}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">Outstanding Balance</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {loading ? '—' : `$${money(totals.outstanding)}`}
          </div>
          <div className="mt-2 text-xs text-gray-500">From recent invoices</div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">Paid (recent)</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {loading ? '—' : `$${money(totals.paid)}`}
          </div>
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
          <button
            type="button"
            onClick={() => navigate('/reports')}
            className="text-sm text-blue-700 hover:text-blue-800"
          >
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
                const invoiceId = String(inv?.id || '');
                const invoiceNumber = String(inv?.invoice_number || '');
                const clientName = String(inv?.company_name || '');
                const status = String(inv?.status || '').toLowerCase();

                return (
                  <tr key={isSkeleton ? `sk-${idx}` : invoiceId}>
                    <td className="px-6 py-4">
                      {isSkeleton ? (
                        <div className="h-4 w-28 bg-gray-100 rounded" />
                      ) : (
                        <div className="font-medium text-gray-900">{invoiceNumber || invoiceId}</div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isSkeleton ? (
                        <div className="h-4 w-40 bg-gray-100 rounded" />
                      ) : (
                        <div className="text-gray-700">{clientName || '—'}</div>
                      )}
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
                      {isSkeleton ? (
                        <div className="h-4 w-16 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <span className="text-gray-900">${money(inv?.total_amount)}</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSkeleton ? (
                        <div className="h-4 w-16 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <span className="text-gray-900">${money(inv?.balance)}</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSkeleton ? (
                        <div className="h-8 w-20 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => downloadInvoicePdf(invoiceId, invoiceNumber)}
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

      {/* Note: Transactions are not shown because you currently don't have a list endpoint.
          Once you add GET /api/transactions (list), we’ll include “recent transactions” here. */}
    </div>
  );
}
