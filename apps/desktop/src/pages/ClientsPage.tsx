import { useEffect, useMemo, useState } from 'react';
import { Users, Search, RefreshCcw, AlertTriangle } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';

type ClientRow = {
  id: string;
  company_name?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  tax_id?: string;
  payment_terms?: string;
  credit_limit?: number | string;
  current_balance?: number | string;
  is_active?: boolean;
  created_at?: string;
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

export default function ClientsPage() {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);

  async function load() {
    setError('');
    setLoading(true);
    try {
      // backend already has GET /api/clients (your web dashboard uses it)
      const data = await safeGetArray<ClientRow>('/api/clients?limit=500');
      setRows(data);
    } catch (e: any) {
      setRows([]);
      setError(e?.message || 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = rows;

    if (onlyActive) out = out.filter((c) => c.is_active !== false);

    if (!term) return out;

    return out.filter((c) => {
      const company = String(c.company_name || '').toLowerCase();
      const person = String(c.contact_person || '').toLowerCase();
      const phone = String(c.phone || '').toLowerCase();
      const email = String(c.email || '').toLowerCase();
      const tax = String(c.tax_id || '').toLowerCase();
      return (
        company.includes(term) ||
        person.includes(term) ||
        phone.includes(term) ||
        email.includes(term) ||
        tax.includes(term)
      );
    });
  }, [rows, q, onlyActive]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
            <p className="text-sm text-gray-600">Quick lookup for weighing workflow (read-only)</p>
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
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by company/contact/phone/email/tax ID…"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Active only
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-600">
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Contact</th>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3 text-right">Balance</th>
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
                    No clients found.
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((c) => (
                  <tr key={c.id} className="border-b last:border-b-0 border-gray-100">
                    <td className="px-5 py-4">
                      <div className="font-medium text-gray-900">{c.company_name || '—'}</div>
                      <div className="text-xs text-gray-500">{c.payment_terms || '—'}</div>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{c.contact_person || '—'}</td>
                    <td className="px-5 py-4 text-gray-700">{c.phone || '—'}</td>
                    <td className="px-5 py-4 text-gray-700">{c.email || '—'}</td>
                    <td className="px-5 py-4 text-right text-gray-900">
                      {num(c.current_balance, 0).toFixed(2)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                          c.is_active === false
                            ? 'bg-gray-100 text-gray-700'
                            : 'bg-green-50 text-green-700'
                        }`}
                      >
                        {c.is_active === false ? 'Inactive' : 'Active'}
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
