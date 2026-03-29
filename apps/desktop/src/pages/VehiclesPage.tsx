import { useEffect, useMemo, useState } from 'react';
import { Car, RefreshCcw, AlertTriangle, Search } from 'lucide-react';
import { apiClient } from '@weighbridge/shared';

type ClientRow = {
  id: string;
  company_name?: string;
  name?: string;
};

type VehicleRow = {
  id: string;
  client_id?: string;
  license_plate?: string;
  vehicle_type?: string;
  make?: string;
  model?: string;
  year?: number;
  tare_weight?: number | string;
  max_capacity?: number | string;

  // denormalized for UI
  company_name?: string;
};

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

function displayClientName(c: ClientRow | undefined | null): string {
  return String(c?.company_name || c?.name || '').trim();
}

export default function VehiclesPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState<string>('');

  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingClients, setLoadingClients] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');

  const selectedClient = useMemo(
    () => clients.find((c) => String(c.id) === String(clientId)) ?? null,
    [clients, clientId]
  );

  const clientNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) {
      const name = displayClientName(c);
      if (c?.id) m.set(String(c.id), name || '—');
    }
    return m;
  }, [clients]);

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

  async function loadClients() {
    setLoadingClients(true);
    setError('');
    try {
      const data = await safeGetArray<ClientRow>('/api/clients?limit=500');
      setClients(data);

      if (!clientId && data?.length) setClientId(String(data[0].id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load clients';
      setError(msg);
      setClients([]);
    } finally {
      setLoadingClients(false);
    }
  }

  async function loadVehicles() {
    setError('');
    setLoading(true);

    try {
      if (!clientId) {
        setRows([]);
        return;
      }

      const data = await safeGetArray<VehicleRow>(
        `/api/vehicles?client_id=${encodeURIComponent(clientId)}&limit=100`
      );

      const hydrated = data.map((v) => ({
        ...v,
        company_name:
          v.company_name ||
          (v.client_id ? clientNameMap.get(String(v.client_id)) : null) ||
          displayClientName(selectedClient) ||
          '—',
      }));

      setRows(hydrated);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load vehicles';

      if (isNotFoundOrNotImplemented(msg)) {
        setError('Vehicles endpoint is not available yet in the backend.');
      } else {
        setError(msg);
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadingClients) void loadVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, loadingClients]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Car className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Vehicles</h1>
        </div>

        <button
          type="button"
          onClick={() => void loadVehicles()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
          disabled={loading || loadingClients || !clientId}
          title={!clientId ? 'Select a client first' : 'Refresh'}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
              disabled={loadingClients}
            >
              {!clients.length && <option value="">No clients available</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {displayClientName(c) || c.id}
                </option>
              ))}
            </select>

            {!clientId && (
              <div className="mt-2 text-xs text-amber-700">
                Select a client to view vehicles (backend requires <b>client_id</b>).
              </div>
            )}
          </div>

          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-[34px]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plate, type, make/model..."
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg"
              disabled={!clientId}
            />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">
            Vehicle registry (lookup){selectedClient ? ` • ${displayClientName(selectedClient) || 'Client'}` : ''}
          </div>
          <div className="text-sm text-gray-500">
            {loading || loadingClients ? 'Loading...' : `${filtered.length} result(s)`}
          </div>
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
              {!loading && !loadingClients && clientId && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={4}>
                    No vehicles found for this client.
                  </td>
                </tr>
              )}

              {!clientId && !loadingClients && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={4}>
                    Select a client to load vehicles.
                  </td>
                </tr>
              )}

              {(loading || loadingClients ? Array.from({ length: 6 }) : filtered).map((v: any, idx: number) => {
                const isSk = loading || loadingClients;
                const id = String(v?.id || `sk-${idx}`);

                const plate = String(v?.license_plate || '—');
                const type = String(v?.vehicle_type || '—');
                const makeModel = [v?.make, v?.model, v?.year].filter(Boolean).join(' ');
                const client = String(v?.company_name || displayClientName(selectedClient) || '—');

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
