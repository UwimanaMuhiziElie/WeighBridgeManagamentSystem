import { useEffect, useMemo, useState } from 'react';
import { List, RefreshCcw, AlertTriangle, Search, Play } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';

type TransactionRow = {
  id: string;
  transaction_number?: string;
  status?: string;
  transaction_type?: string;
  client_id?: string | null;
  vehicle_id?: string | null;
  operator_id?: string | null;
  walk_in_name?: string | null;
  assigned_truck_id?: number | string | null;
  truck_side_number?: string | null;
  first_weight?: number | string;
  first_weight_time?: string;
  second_weight?: number | string;
  net_weight?: number | string;
  material_type?: string;
  reference_number?: string;
  created_at?: string;
  company_name?: string;
  license_plate?: string;
  vehicle_type?: string;
};

const RESUME_KEY = 'weighing_resume_tx';

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
    Array.isArray(root)
      ? root
      : Array.isArray(root?.data)
        ? root.data
        : Array.isArray(root?.rows)
          ? root.rows
          : Array.isArray(root?.data?.rows)
            ? root.data.rows
            : [];

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

function isOpenStatus(s: string) {
  const v = (s || '').toLowerCase();
  return v === 'pending' || v === 'in_progress';
}

function asStringOrEmpty(v: any): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function asStringOrNull(v: any): string | null {
  const s = asStringOrEmpty(v).trim();
  return s ? s : null;
}
function asNumberOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

export default function TransactionsPage() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'completed' | 'cancelled'>('all');

  const counts = useMemo(() => {
    const open = rows.filter((r) => isOpenStatus(String(r.status || ''))).length;
    const completed = rows.filter((r) => String(r.status || '').toLowerCase() === 'completed').length;
    const cancelled = rows.filter((r) => String(r.status || '').toLowerCase() === 'cancelled').length;
    return { open, completed, cancelled, all: rows.length };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;

    if (statusFilter === 'open') {
      list = list.filter((t) => isOpenStatus(String(t.status || '')));
    } else if (statusFilter === 'completed') {
      list = list.filter((t) => String(t.status || '').toLowerCase() === 'completed');
    } else if (statusFilter === 'cancelled') {
      list = list.filter((t) => String(t.status || '').toLowerCase() === 'cancelled');
    }

    const q = search.trim().toLowerCase();
    if (!q) return list;

    return list.filter((t) => {
      const hay = [
        t.transaction_number,
        t.status,
        t.transaction_type,
        t.material_type,
        t.reference_number,
        t.company_name,
        t.license_plate,
        t.vehicle_type,
        t.walk_in_name,
        t.truck_side_number,
        t.assigned_truck_id != null ? String(t.assigned_truck_id) : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return hay.includes(q);
    });
  }, [rows, search, statusFilter]);

  async function load() {
    setError('');
    setNotice('');
    setLoading(true);

    try {
      const data = await safeGetArray<TransactionRow>('/api/transactions?limit=200');
      setRows(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load transactions';
      if (isNotFoundOrNotImplemented(msg)) {
        setError(
          'Transactions list endpoint is not available yet in the backend. Add GET /api/transactions (list) to enable this page.'
        );
      } else {
        setError(msg);
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function resumeTx(t: TransactionRow) {
    setError('');
    setNotice('');

    const status = String(t.status || '').toLowerCase();
    if (!isOpenStatus(status)) {
      setError('Only pending/in_progress transactions can be resumed.');
      return;
    }

    const id = String(t.id || '').trim();
    if (!id) {
      setError('Cannot resume: missing transaction id.');
      return;
    }

    // Accept both snake_case + camelCase
    let clientId: string | null =
      asStringOrNull((t as any).client_id ?? (t as any).clientId) ?? null;

    let vehicleId: string | null =
      asStringOrNull((t as any).vehicle_id ?? (t as any).vehicleId) ?? null;

    let walkInName: string =
      asStringOrEmpty((t as any).walk_in_name ?? (t as any).walkInName);

    let assignedTruckId: number | null =
      asNumberOrNull((t as any).assigned_truck_id ?? (t as any).assignedTruckId);

    let truckSideNumber: string =
      asStringOrEmpty((t as any).truck_side_number ?? (t as any).truckSideNumber);

    // If list row is missing important info, fetch full details by id
    // ✅ NOTE: vehicle_id is OPTIONAL, so we only fetch if we lack BOTH client_id and walk-in name,
    // or we want to enrich payload (assigned ids etc).
    if ((!clientId && !walkInName) || assignedTruckId === null) {
      try {
        const resp = await apiClient.get(`/api/transactions/${encodeURIComponent(id)}`);
        const err = pickErrorMessage(resp);
        if (err) throw new Error(err);

        const payload = (resp as any)?.data ?? resp;
        const row = payload?.data ?? payload;

        clientId = asStringOrNull(row?.client_id ?? row?.clientId) ?? clientId;
        vehicleId = asStringOrNull(row?.vehicle_id ?? row?.vehicleId) ?? vehicleId;

        walkInName = asStringOrEmpty(row?.walk_in_name ?? row?.walkInName) || walkInName;

        const at = asNumberOrNull(row?.assigned_truck_id ?? row?.assignedTruckId);
        assignedTruckId = at ?? assignedTruckId;

        truckSideNumber = asStringOrEmpty(row?.truck_side_number ?? row?.truckSideNumber) || truckSideNumber;

        // merge extra fields back onto t (optional but helpful)
        t = { ...(t as any), ...(row as any) };
      } catch (e: any) {
        setError(e?.message || 'Failed to fetch transaction details for resume.');
        return;
      }
    }

    // ✅ Correct resume rule:
    // - Must be either client transaction (client_id exists)
    // - OR walk-in (walk_in_name exists)
    // - vehicle_id may legitimately be null
    const hasClientOrWalkIn = !!(clientId || (walkInName || '').trim());
    if (!hasClientOrWalkIn) {
      setError('Cannot resume: missing client_id / walk_in_name (check GET /api/transactions/:id).');
      return;
    }

    const payload = {
      id,
      transaction_number: String(t.transaction_number || ''),
      status,
      first_weight: num(t.first_weight, 0),

      // WeighingPage expects these snake_case keys
      client_id: clientId || null,
      vehicle_id: vehicleId || null, // ✅ optional

      walk_in_name: (walkInName || '').trim(),
      assigned_truck_id: assignedTruckId,
      truck_side_number: (truckSideNumber || '').trim(),

      // optional display fields (safe)
      company_name: String(t.company_name || ''),
      license_plate: String(t.license_plate || ''),
      vehicle_type: String(t.vehicle_type || ''),
    };

    localStorage.setItem(RESUME_KEY, JSON.stringify(payload));

    setNotice(
      `Saved for resume: ${payload.transaction_number || payload.id}. Switching to Weighing to record the SECOND weight...`
    );

    // ✅ state-based navigation
    try {
      window.dispatchEvent(new CustomEvent('wb:navigate', { detail: { page: 'weighing' } }));
    } catch {
      // ignore
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
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {notice && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
          {notice}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-3">
          {[
            { k: 'all', label: `All (${counts.all})` },
            { k: 'open', label: `Open (${counts.open})` },
            { k: 'completed', label: `Completed (${counts.completed})` },
            { k: 'cancelled', label: `Cancelled (${counts.cancelled})` },
          ].map((b) => (
            <button
              key={b.k}
              type="button"
              onClick={() => setStatusFilter(b.k as any)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                statusFilter === b.k
                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

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
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">Recent transactions</div>
          <div className="text-sm text-gray-500">{loading ? 'Loading...' : `${filtered.length} result(s)`}</div>
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
                <th className="text-right font-medium px-6 py-3">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={7}>
                    No transactions found.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 8 }) : filtered).map((t: any, idx: number) => {
                const isSk = loading;
                const id = String(t?.id || `sk-${idx}`);
                const tn = String(t?.transaction_number || '');
                const status = String(t?.status || '').toLowerCase();
                const client = String(t?.company_name || (t?.walk_in_name ? `Walk-in: ${String(t.walk_in_name)}` : '—'));
                const vehicle = String(t?.license_plate || '—');
                const created = t?.created_at ? new Date(String(t.created_at)).toLocaleString() : '—';

                const net = status === 'completed' ? `${num(t?.net_weight, 0).toFixed(2)} kg` : '—';
                const canResume = !isSk && isOpenStatus(status);

                return (
                  <tr key={id}>
                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-32 bg-gray-100 rounded" />
                      ) : (
                        <div className="font-medium text-gray-900">{tn || id}</div>
                      )}
                      {!isSk && t?.reference_number ? (
                        <div className="text-xs text-gray-500">Ref: {String(t.reference_number)}</div>
                      ) : null}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-40 bg-gray-100 rounded" />
                      ) : (
                        <div className="text-gray-700">{client}</div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-28 bg-gray-100 rounded" />
                      ) : (
                        <div className="text-gray-700">
                          {vehicle}
                          {t?.vehicle_type ? (
                            <span className="text-xs text-gray-500"> • {String(t.vehicle_type)}</span>
                          ) : null}
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
                        <span className="text-gray-900">{net}</span>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-28 bg-gray-100 rounded" />
                      ) : (
                        <span className="text-gray-700">{created}</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? (
                        <div className="h-8 w-20 bg-gray-100 rounded ml-auto" />
                      ) : canResume ? (
                        <button
                          type="button"
                          onClick={() => void resumeTx(t)}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                        >
                          <Play className="w-4 h-4" />
                          Resume
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
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
