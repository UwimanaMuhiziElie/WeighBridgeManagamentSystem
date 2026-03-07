// apps/desktop/src/pages/ReportsPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, RefreshCcw, AlertTriangle, Download, FileText } from 'lucide-react';
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

  // ✅ best-effort: backend may already send this
  client_id?: string;
};

function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp.error) return String(resp.error);
  if (resp.success === false) return String(resp.error || resp.message || 'Request failed');
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

async function safeGetArray<T = any>(endpoint: string): Promise<T[]> {
  const resp = await apiClient.get<any>(endpoint);
  const err = pickErrorMessage(resp);
  if (err) throw new Error(err);
  return unwrapArray<T>(resp);
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildTxQuery(f: ReportFiltersValue) {
  const qs = new URLSearchParams();
  qs.set('limit', '500');
  qs.set('from', f.from);
  qs.set('to', f.to);

  if (f.status) qs.set('status', f.status);

  // best-effort: backend may ignore, but safe to send
  if (f.client_id) qs.set('client_id', f.client_id);

  return `/api/transactions?${qs.toString()}`;
}

function b64ToBlob(base64: string, mime: string) {
  const clean = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
  const bin = atob(clean);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadBlob(filename: string, blob: Blob) {
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
    const t = todayISO();
    return { from: t, to: t, status: '', client_id: '' };
  });

  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

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

      // ✅ client filter: works if backend includes client_id in rows
      const clientOk = filters.client_id
        ? String((t as any).client_id || '') === filters.client_id
        : true;

      return inRange && statusOk && clientOk;
    });
  }, [rows, filters]);

  const summary = useMemo(() => {
    const totalTx = filtered.length;
    const completed = filtered.filter((t) => String(t.status || '').toLowerCase() === 'completed').length;
    const totalNet = filtered.reduce((sum, t) => sum + num(t.net_weight, 0), 0);
    return { totalTx, completed, totalNet };
  }, [filtered]);

  async function load(next?: ReportFiltersValue) {
    const f = next ?? filtersRef.current;

    setError('');
    setLoading(true);

    try {
      const data = await safeGetArray<TransactionRow>(buildTxQuery(f));
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

  async function downloadClientStatementPdf() {
    const f = filtersRef.current;

    if (!f.client_id) {
      setError('Select a client first, then click PDF Statement.');
      return;
    }

    setError('');

    try {
      const qs = new URLSearchParams({
        from: f.from,
        to: f.to,
        client_id: f.client_id,
        unpaid_only: '1',
      });

      const resp = await apiClient.get<any>(`/api/reports/client-statement?${qs.toString()}`);
      const err = pickErrorMessage(resp);
      if (err) throw new Error(err);

      const data = resp?.data ?? resp;
      const base64 = data?.base64 || data?.pdf_base64 || data?.data?.base64;
      const filename = data?.filename || `statement_${f.from}_to_${f.to}.pdf`;
      const mime = data?.mime || 'application/pdf';

      if (!base64) throw new Error('Statement PDF payload missing (base64 not found).');

      const blob = b64ToBlob(String(base64), String(mime));
      downloadBlob(String(filename), blob);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to download statement PDF';
      setError(msg);
    }
  }

  useEffect(() => {
    void load(filtersRef.current);
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
            onClick={() => void downloadClientStatementPdf()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-50"
            disabled={!filters.client_id}
            title={!filters.client_id ? 'Select a client to enable PDF Statement' : 'Download monthly unpaid statement'}
          >
            <FileText className="w-4 h-4" />
            PDF Statement
          </button>

          <button
            type="button"
            onClick={() => {
              if (filtered.length === 0) return;
              downloadCsv(
                `operator-report-${filters.from}-to-${filters.to}.csv`,
                filtered.map((t) => ({
                  transaction_number: t.transaction_number || '',
                  status: t.status || '',
                  net_weight: num(t.net_weight, 0),
                  client: t.company_name || '',
                  vehicle: t.license_plate || '',
                  created_at: t.created_at || '',
                }))
              );
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
          onApply={(v) => {
            setFilters(v);
            void load(v);
          }}
          onClear={() => {
            const cleared: ReportFiltersValue = { from: todayISO(), to: todayISO(), status: '', client_id: '' };
            setFilters(cleared);
            void load(cleared);
          }}
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
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {loading ? '—' : `${summary.totalNet.toFixed(2)} kg`}
          </div>
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
