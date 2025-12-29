import { useEffect, useMemo, useState } from 'react';
import { Car, RefreshCcw, AlertTriangle, Search } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';

type VehicleRow = {
  id: string;
  license_plate?: string;
  vehicle_type?: string;
  make?: string;
  model?: string;
  year?: number;
  tare_weight?: number | string;
  max_capacity?: number | string;

  // optional joined/denormalized
  company_name?: string;
};

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

export default function VehiclesPage() {
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((v) => {
      const hay = [v.license_plate, v.vehicle_type, v.make, v.model, v.company_name]
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
      const data = await safeGetArray<VehicleRow>('/api/vehicles?limit=100');
      setRows(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load vehicles';
      if (isNotFoundOrNotImplemented(msg)) {
        setError('Vehicles list endpoint is not available yet in the backend. Add GET /api/vehicles (list) to enable quick lookup.');
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
          <Car className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Vehicles</h1>
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
            placeholder="Search plate, type, make/model, client..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">Vehicle registry (lookup)</div>
          <div className="text-sm text-gray-500">{loading ? 'Loading...' : `${filtered.length} result(s)`}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Plate</th>
                <th className="text-left font-medium px-6 py-3">Type</th>
                <th className="text-left font-medium px-6 py-3">Make/Model</th>
                <th className="text-left font-medium px-6 py-3">Client</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={4}>
                    No vehicles found.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 8 }) : filtered).map((v: any, idx: number) => {
                const isSk = loading;
                const id = String(v?.id || `sk-${idx}`);

                const plate = String(v?.license_plate || '—');
                const type = String(v?.vehicle_type || '—');
                const makeModel = [v?.make, v?.model, v?.year].filter(Boolean).join(' ');
                const client = String(v?.company_name || '—');

                return (
                  <tr key={id}>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-24 bg-gray-100 rounded" /> : <div className="font-medium text-gray-900">{plate}</div>}
                    </td>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-24 bg-gray-100 rounded" /> : <div className="text-gray-700">{type}</div>}
                    </td>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-40 bg-gray-100 rounded" /> : <div className="text-gray-700">{makeModel || '—'}</div>}
                    </td>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-40 bg-gray-100 rounded" /> : <div className="text-gray-700">{client}</div>}
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
