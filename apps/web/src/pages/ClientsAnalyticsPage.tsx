import { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { Branch } from '@weighbridge/shared';

function isForbiddenError(msg: string) {
  const m = (msg || '').toLowerCase();
  return m.includes('forbidden') || m.includes('403') || m.includes('request failed (403)');
}

function toISODate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

type ClientsAnalytics = {
  range: { from: string; to: string; branch_id: string | null };
  top_clients: Array<{ client_id: string; client_name: string | null; invoices: number; total_value: number | null }>;
  repeat_clients: { count: number };
  invoice_aging: Array<{ bucket: string; count: number; value: number | null }>;
};

export default function ClientsAnalyticsPage() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toISODate(d);
  });
  const [to, setTo] = useState(() => toISODate(new Date()));

  const [data, setData] = useState<ClientsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
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

    if (isAdminOrManager) {
      const bResp = await apiClient.get<Branch[]>('/api/branches');
      if (!mountedRef.current) return;
      if ((bResp as any)?.error) {
        const msg = String((bResp as any).error || 'Failed to load branches');
        setBranches([]);
        setPageError(msg);
        if (isForbiddenError(msg)) setAccessDenied(true);
      } else {
        setBranches(Array.isArray(bResp.data) ? bResp.data : []);
      }
    }

    await loadAnalytics();
    setLoading(false);
  }

  async function loadAnalytics() {
    setPageError('');
    setAccessDenied(false);

    const qs = new URLSearchParams();
    qs.set('from', from);
    qs.set('to', to);

    // only allow branch switch for admin/manager
    if (isAdminOrManager && selectedBranch) qs.set('branch_id', selectedBranch);

    const resp = await apiClient.get<ClientsAnalytics>(`/api/analytics/clients?${qs.toString()}`);

    if (!mountedRef.current) return;

    if ((resp as any)?.error) {
      const msg = String((resp as any).error || 'Failed to load client analytics');
      setData(null);
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
      return;
    }

    setData(resp.data as any);
  }

  const branchLabel = useMemo(() => {
    if (!isAdminOrManager) return 'My branch';
    if (!selectedBranch) return 'All branches';
    return branches.find(b => b.id === selectedBranch)?.name || selectedBranch;
  }, [isAdminOrManager, selectedBranch, branches]);

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
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
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
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            disabled={!isAdminOrManager}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
          >
            {!isAdminOrManager ? (
              <option value="">My branch</option>
            ) : (
              <>
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </>
            )}
          </select>
          <div className="text-xs text-gray-500 mt-1">Current: {branchLabel}</div>
        </div>

        <div className="md:col-span-4 flex justify-end">
          <button
            onClick={() => void loadAnalytics()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Apply
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
                  x.total_value == null ? '—' : String(x.total_value),
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
                  x.value == null ? '—' : String(x.value),
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

function SimpleTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  if (!rows.length) {
    return <div className="text-gray-600 text-sm">{empty}</div>;
  }
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
