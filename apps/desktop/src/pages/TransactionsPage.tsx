import { useEffect, useMemo, useState } from 'react';
import { List, RefreshCcw, AlertTriangle, Search } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';

type TransactionRow = {
  id: string;
  transaction_number?: string;
  status?: string;
  transaction_type?: string;
  net_weight?: number | string;
  material_type?: string;
  reference_number?: string;
  created_at?: string;

  // Optional denormalized/joined fields (depends on backend)
  company_name?: string;
  license_plate?: string;
  vehicle_type?: string;
};

function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
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

function isNotFoundOrNotImplemented(msg: string) {
  const s = (msg || '').toLowerCase();
  return s.includes('404') || s.includes('not found') || s.includes('cannot get') || s.includes('not implemented');
}

export default function TransactionsPage() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((t) => {
      const hay = [
        t.transaction_number,
        t.status,
        t.transaction_type,
        t.material_type,
        t.reference_number,
        t.company_name,
        t.license_plate,
        t.vehicle_type,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return hay.includes(q);
    });
  }, [rows, search]);

  async function load() {
    setError('');
    setLoading(true);

    try {
      // If your backend supports it later, keep the same endpoint signature.
      const data = await safeGetArray<TransactionRow>('/api/transactions?limit=50');
      setRows(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load transactions';
      if (isNotFoundOrNotImplemented(msg)) {
        setError('Transactions list endpoint is not available yet in the backend. Add GET /api/transactions (list) to enable this page.');
      } else {
        setError(msg);
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <List className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Transactions</h1>
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
            placeholder="Search by transaction #, plate, client, status..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-gray-900">Recent transactions</div>
            <div className="text-sm text-gray-500">
              {loading ? 'Loading...' : `${filtered.length} result(s)`}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Transaction</th>
                <th className="text-left font-medium px-6 py-3">Client</th>
                <th className="text-left font-medium px-6 py-3">Vehicle</th>
                <th className="text-left font-medium px-6 py-3">Status</th>
                <th className="text-right font-medium px-6 py-3">Net weight</th>
                <th className="text-left font-medium px-6 py-3">Created</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={6}>
                    No transactions found.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 8 }) : filtered).map((t: any, idx: number) => {
                const isSk = loading;
                const id = String(t?.id || `sk-${idx}`);
                const tn = String(t?.transaction_number || '');
                const status = String(t?.status || '').toLowerCase();
                const client = String(t?.company_name || '—');
                const vehicle = String(t?.license_plate || '—');
                const created = t?.created_at ? new Date(String(t.created_at)).toLocaleString() : '—';

                return (
                  <tr key={id}>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-32 bg-gray-100 rounded" /> : <div className="font-medium text-gray-900">{tn || id}</div>}
                      {!isSk && t?.reference_number ? (
                        <div className="text-xs text-gray-500">Ref: {String(t.reference_number)}</div>
                      ) : null}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-40 bg-gray-100 rounded" /> : <div className="text-gray-700">{client}</div>}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-28 bg-gray-100 rounded" />
                      ) : (
                        <div className="text-gray-700">
                          {vehicle}
                          {t?.vehicle_type ? <span className="text-xs text-gray-500"> • {String(t.vehicle_type)}</span> : null}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-20 bg-gray-100 rounded" />
                      ) : (
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            status === 'completed'
                              ? 'bg-green-50 text-green-700'
                              : status === 'cancelled'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-yellow-50 text-yellow-700'
                          }`}
                        >
                          {status || 'unknown'}
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? (
                        <div className="h-4 w-16 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <span className="text-gray-900">{num(t?.net_weight, 0).toFixed(2)} kg</span>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-28 bg-gray-100 rounded" /> : <span className="text-gray-700">{created}</span>}
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
