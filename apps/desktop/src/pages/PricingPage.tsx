import { useEffect, useMemo, useState } from 'react';
import { DollarSign, RefreshCcw, AlertTriangle, Search } from 'lucide-react';
import { apiClient } from '@weighbridge/shared';

type ClientLite = { id: string; company_name: string };

type PricingRule = {
  id: string;
  name?: string;
  material_type?: string | null;
  vehicle_type?: string | null;
  min_weight?: number | string | null;
  max_weight?: number | string | null;
  price_per_unit?: number | string;
  unit_type?: 'kg' | 'ton' | 'lb' | 'item' | 'mattress' | 'count' | string;
  priority?: number | string;
  is_active?: boolean;
  effective_from?: string | null;
  effective_until?: string | null;

  // needed for negotiated rules filtering
  client_id?: string | null;
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

async function safeGetArray<T>(endpoint: string): Promise<T[]> {
  const resp = await apiClient.get<any>(endpoint);
  const err = pickErrorMessage(resp);
  if (err) throw new Error(err);
  return unwrapArray<T>(resp);
}

function isNotFoundOrNotImplemented(msg: string) {
  const s = (msg || '').toLowerCase();
  return s.includes('404') || s.includes('not found') || s.includes('cannot get') || s.includes('not implemented');
}

export default function PricingPage() {
  const [rows, setRows] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');

  // ---- client filter state ----
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [clientQuery, setClientQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientLite | null>(null);
  const [openSuggestions, setOpenSuggestions] = useState(false);
  const [searchingClients, setSearchingClients] = useState(false);
  const [clientsUnavailable, setClientsUnavailable] = useState(false);

  // include standard rules when a client is selected
  const [includeStandard, setIncludeStandard] = useState(true);

  async function loadRules() {
    setError('');
    setLoading(true);
    try {
      const data = await safeGetArray<PricingRule>('/api/pricingRules?limit=500');
      setRows(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load pricing rules';
      if (isNotFoundOrNotImplemented(msg)) {
        setError('Pricing rules endpoint is not available yet. Configure pricing in the web app.');
      } else {
        setError(msg);
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadClients(qText: string) {
    if (clientsUnavailable) return;
    setSearchingClients(true);

    try {
      const qs = new URLSearchParams();
      qs.set('limit', '30');
      if (qText.trim()) qs.set('q', qText.trim());

      // same endpoint used by admin web pricing page
      const list = await safeGetArray<ClientLite>(`/api/pricing/clients?${qs.toString()}`);
      setClients(list);
    } catch (e: any) {
      const msg = String(e?.message || '');
      // if backend doesn't expose this to operator, don't crash the page
      if (isNotFoundOrNotImplemented(msg) || msg.toLowerCase().includes('403') || msg.toLowerCase().includes('forbidden')) {
        setClientsUnavailable(true);
        setClients([]);
      } else {
        setClients([]);
      }
    } finally {
      setSearchingClients(false);
    }
  }

  useEffect(() => {
    void loadRules();
    void loadClients('');
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadClients(clientQuery), 250);
    return () => clearTimeout(t);
  }, [clientQuery]);

  const filtered = useMemo(() => {
    let base = rows;

    // client filtering
    if (selectedClient?.id) {
      base = base.filter((r) => {
        const isStandard = !r.client_id;
        const isForClient = r.client_id === selectedClient.id;
        return includeStandard ? (isStandard || isForClient) : isForClient;
      });
    }

    // text search
    const term = q.trim().toLowerCase();
    if (!term) return base;

    return base.filter((r) => {
      const name = String(r.name || '').toLowerCase();
      const mat = String(r.material_type || '').toLowerCase();
      const veh = String(r.vehicle_type || '').toLowerCase();
      const unit = String(r.unit_type || '').toLowerCase();
      return name.includes(term) || mat.includes(term) || veh.includes(term) || unit.includes(term);
    });
  }, [rows, q, selectedClient, includeStandard]);

  function selectClient(c: ClientLite) {
    setSelectedClient(c);
    setClientQuery(c.company_name);
    setOpenSuggestions(false);
  }

  function clearClient() {
    setSelectedClient(null);
    setClientQuery('');
    setOpenSuggestions(false);
  }

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
          onClick={() => void loadRules()}
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

      {clientsUnavailable && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
          Client search API is not available for this account, so client filtering is disabled.
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 space-y-3">
        {/* Client filter */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">Client filter (optional)</label>
            <div className="relative">
              <input
                value={clientQuery}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  setOpenSuggestions(true);
                }}
                onFocus={() => setOpenSuggestions(true)}
                onBlur={() => setTimeout(() => setOpenSuggestions(false), 150)}
                disabled={clientsUnavailable}
                placeholder={clientsUnavailable ? 'Client filtering not available' : 'Type client name…'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-50"
              />

              {selectedClient && (
                <button
                  type="button"
                  onClick={clearClient}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                >
                  Clear
                </button>
              )}

              {openSuggestions && !clientsUnavailable && clients.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-sm max-h-64 overflow-auto">
                  {clients.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectClient(c)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50"
                    >
                      <div className="text-sm font-medium text-gray-900">{c.company_name}</div>
                      <div className="text-xs text-gray-500 font-mono">{c.id}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1">{searchingClients ? 'Searching clients…' : ''}</div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Choose</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeStandard}
                onChange={(e) => setIncludeStandard(e.target.checked)}
                disabled={!selectedClient}
              />
              Include standard prices
            </label>
          </div>
        </div>

        {/* Search */}
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
                      <div className="text-xs text-gray-500">
                        Priority: {num(r.priority, 0)} • {r.client_id ? 'Negotiated' : 'Standard'}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{r.material_type || '—'}</td>
                    <td className="px-5 py-4 text-gray-700">{r.vehicle_type || '—'}</td>
                    <td className="px-5 py-4 text-right text-gray-900">
                      {num(r.price_per_unit, 0).toFixed(2)} / {r.unit_type || 'unit'}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-700">
                      {r.min_weight != null || r.max_weight != null ? `${r.min_weight ?? '—'} → ${r.max_weight ?? '—'}` : '—'}
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
