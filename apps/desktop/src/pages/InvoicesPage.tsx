import { useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCcw, AlertTriangle, Download, Search } from 'lucide-react';
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

function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}
function money(v: unknown) {
  return num(v, 0).toFixed(2);
}

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
  const arr =
    Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.rows) ? data.rows :
    [];

  return Array.isArray(arr) ? (arr as T[]) : [];
}

export default function InvoicesPage() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((inv) => {
      const hay = [inv.invoice_number, inv.company_name, inv.status].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  async function load() {
    setError('');
    setLoading(true);
    try {
      const data = await safeGetArray<InvoiceRow>('/api/invoices?limit=50');
      setRows(data);
    } catch (e: unknown) {
      setRows([]);
      setError(e instanceof Error ? e.message : 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
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
        headers: { Authorization: `Bearer ${token}` },
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to download invoice PDF');
    }
  }

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

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="relative">
          <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by invoice #, client, status..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">Recent invoices</div>
          <div className="text-sm text-gray-500">{loading ? 'Loading...' : `${filtered.length} result(s)`}</div>
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
              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={6}>
                    No invoices found.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 8 }) : filtered).map((inv: any, idx: number) => {
                const isSk = loading;
                const id = String(inv?.id || `sk-${idx}`);
                const invoiceNumber = String(inv?.invoice_number || '');
                const client = String(inv?.company_name || '—');
                const status = String(inv?.status || '').toLowerCase();

                return (
                  <tr key={id}>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-28 bg-gray-100 rounded" /> : <div className="font-medium text-gray-900">{invoiceNumber || id}</div>}
                      {!isSk && inv?.invoice_date ? (
                        <div className="text-xs text-gray-500">{String(inv.invoice_date)}</div>
                      ) : null}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-40 bg-gray-100 rounded" /> : <div className="text-gray-700">{client}</div>}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
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
                      {isSk ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <span className="text-gray-900">${money(inv?.total_amount)}</span>}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <span className="text-gray-900">${money(inv?.balance)}</span>}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? (
                        <div className="h-8 w-20 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => downloadInvoicePdf(id, invoiceNumber)}
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
