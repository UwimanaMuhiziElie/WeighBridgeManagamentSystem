import { useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCcw, AlertTriangle, Download } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import ReportFilters, { ReportFiltersValue } from '../components/ReportFilters';

type TransactionRow = {
  id: string;
  transaction_number?: string;
  status?: string;
  net_weight?: number | string;
  created_at?: string;
  company_name?: string;
  license_plate?: string;
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

function toMsRange(from: string, to: string) {
  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T23:59:59`).getTime();
  return { fromMs, toMs };
}

function downloadCsv(filename: string, rows: Record<string, any>[]) {
  const keys = Object.keys(rows[0] || {});
  const lines = [
    keys.join(','),
    ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(',')),
  ];
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

export default function ReportsPage() {
  const [filters, setFilters] = useState<ReportFiltersValue>(() => {
    const t = new Date().toISOString().slice(0, 10);
    return { from: t, to: t, status: '' };
  });

  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const { fromMs, toMs } = toMsRange(filters.from, filters.to);

    return rows.filter((t) => {
      const createdMs = t.created_at ? new Date(String(t.created_at)).getTime() : 0;
      const inRange = createdMs ? createdMs >= fromMs && createdMs <= toMs : true;

      const st = String(t.status || '').toLowerCase();
      const statusOk = filters.status ? st === filters.status : true;

      return inRange && statusOk;
    });
  }, [rows, filters]);

  const summary = useMemo(() => {
    const totalTx = filtered.length;
    const completed = filtered.filter((t) => String(t.status || '').toLowerCase() === 'completed').length;
    const totalNet = filtered.reduce((sum, t) => sum + num(t.net_weight, 0), 0);
    return { totalTx, completed, totalNet };
  }, [filtered]);

  async function load() {
    setError('');
    setLoading(true);
    try {
      // If backend supports date filters later, keep this signature.
      const data = await safeGetArray<TransactionRow>(
        `/api/transactions?limit=500&from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}`
      );
      setRows(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load report data';
      if (isNotFoundOrNotImplemented(msg)) {
        setError('Reports require GET /api/transactions (list). This endpoint is not available yet.');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-8 h-8 text-blue-600" />
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
              if (filtered.length === 0) return;
              downloadCsv(`operator-report-${filters.from}-to-${filters.to}.csv`, filtered.map((t) => ({
                transaction_number: t.transaction_number || '',
                status: t.status || '',
                net_weight: num(t.net_weight, 0),
                client: t.company_name || '',
                vehicle: t.license_plate || '',
                created_at: t.created_at || '',
              })));
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={filtered.length === 0}
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

      <div className="mb-6">
        <ReportFilters
          value={filters}
          onChange={setFilters}
          onApply={() => void load()}
          onClear={() => void load()}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Transactions</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{loading ? '—' : summary.totalTx}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Completed</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{loading ? '—' : summary.completed}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Total net weight</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{loading ? '—' : `${summary.totalNet.toFixed(2)} kg`}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">Filtered transactions</div>
          <div className="text-sm text-gray-500">{loading ? 'Loading...' : `${filtered.length} row(s)`}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Transaction</th>
                <th className="text-left font-medium px-6 py-3">Client</th>
                <th className="text-left font-medium px-6 py-3">Vehicle</th>
                <th className="text-left font-medium px-6 py-3">Status</th>
                <th className="text-right font-medium px-6 py-3">Net</th>
                <th className="text-left font-medium px-6 py-3">Created</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={6}>
                    No data for selected filters.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 8 }) : filtered).map((t: any, idx: number) => {
                const isSk = loading;
                const id = String(t?.id || `sk-${idx}`);
                const tn = String(t?.transaction_number || id);
                const created = t?.created_at ? new Date(String(t.created_at)).toLocaleString() : '—';

                return (
                  <tr key={id}>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-32 bg-gray-100 rounded" /> : <div className="font-medium text-gray-900">{tn}</div>}
                    </td>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-40 bg-gray-100 rounded" /> : <div className="text-gray-700">{String(t?.company_name || '—')}</div>}
                    </td>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-28 bg-gray-100 rounded" /> : <div className="text-gray-700">{String(t?.license_plate || '—')}</div>}
                    </td>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-20 bg-gray-100 rounded" /> : <div className="text-gray-700">{String(t?.status || '—')}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isSk ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <div className="text-gray-900">{num(t?.net_weight, 0).toFixed(2)} kg</div>}
                    </td>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-28 bg-gray-100 rounded" /> : <div className="text-gray-700">{created}</div>}
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
