import { useEffect, useMemo, useState } from 'react';
import { DollarSign, RefreshCcw, AlertTriangle, Search } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';

type PricingRule = {
  id: string;
  name?: string;
  material_type?: string | null;
  vehicle_type?: string | null;
  min_weight?: number | string | null;
  max_weight?: number | string | null;
  price_per_unit?: number | string;
  unit_type?: 'kg' | 'ton' | 'lb' | string;
  priority?: number | string;
  is_active?: boolean;
  effective_from?: string | null;
  effective_until?: string | null;
};

function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

async function safeGetArray<T>(endpoint: string): Promise<T[]> {
  const resp = await apiClient.get<any>(endpoint);
  if ((resp as any)?.error) throw new Error(String((resp as any).error));

  const data = (resp as any)?.data ?? resp;
  const arr =
    Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.rows) ? data.rows :
    [];
  return Array.isArray(arr) ? (arr as T[]) : [];
}

export default function PricingPage() {
  const [rows, setRows] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setError('');
    setLoading(true);
    try {
      // Recommended backend endpoint for this:
      // GET /api/pricing-rules
      const data = await safeGetArray<PricingRule>('/api/pricing-rules?limit=500');
      setRows(data);
    } catch (e: any) {
      setRows([]);
      setError(
        e?.message ||
          'Pricing rules are not available yet. This is configured by admin/manager in the web app.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => {
      const name = String(r.name || '').toLowerCase();
      const mat = String(r.material_type || '').toLowerCase();
      const veh = String(r.vehicle_type || '').toLowerCase();
      const unit = String(r.unit_type || '').toLowerCase();
      return name.includes(term) || mat.includes(term) || veh.includes(term) || unit.includes(term);
    });
  }, [rows, q]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <DollarSign className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Pricing</h1>
            <p className="text-sm text-gray-600">Read-only view (configured in web app)</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
        >
          <RefreshCcw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pricing rules by name/material/vehicle/unit…"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-600">
                <th className="px-5 py-3">Rule</th>
                <th className="px-5 py-3">Material</th>
                <th className="px-5 py-3">Vehicle</th>
                <th className="px-5 py-3 text-right">Price</th>
                <th className="px-5 py-3 text-right">Weight range</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-gray-500">
                    No pricing rules found.
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 border-gray-100">
                    <td className="px-5 py-4">
                      <div className="font-medium text-gray-900">{r.name || '—'}</div>
                      <div className="text-xs text-gray-500">Priority: {num(r.priority, 0)}</div>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{r.material_type || '—'}</td>
                    <td className="px-5 py-4 text-gray-700">{r.vehicle_type || '—'}</td>
                    <td className="px-5 py-4 text-right text-gray-900">
                      {num(r.price_per_unit, 0).toFixed(2)} / {r.unit_type || 'unit'}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-700">
                      {r.min_weight != null || r.max_weight != null
                        ? `${r.min_weight ?? '—'} → ${r.max_weight ?? '—'}`
                        : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                          r.is_active === false ? 'bg-gray-100 text-gray-700' : 'bg-green-50 text-green-700'
                        }`}
                      >
                        {r.is_active === false ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
