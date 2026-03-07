import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Users, Search, RefreshCcw, AlertTriangle, Plus } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';

type Role = 'operator' | 'admin' | 'manager';

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

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp.error) return String(resp.error);
  if (resp.success === false) return String(resp.message || resp.error || 'Request failed');
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

export default function ClientsPage() {
  const { user } = useAuth();
  const meRole = (user?.role || 'operator') as Role;

  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);

  const [showModal, setShowModal] = useState(false);

  async function load() {
    setError('');
    setLoading(true);
    try {
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
            <p className="text-sm text-gray-600">Lookup + create clients for weighing workflow</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Client
          </button>

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
                    <td className="px-5 py-4 text-right text-gray-900">{num(c.current_balance, 0).toFixed(2)}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                          c.is_active === false ? 'bg-gray-100 text-gray-700' : 'bg-green-50 text-green-700'
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

      {showModal && (
        <AddClientModal
          meRole={meRole}
          onClose={() => setShowModal(false)}
          onSaved={async () => {
            await load();
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}

function AddClientModal({
  meRole,
  onClose,
  onSaved,
}: {
  meRole: Role;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const isAdminOrManager = meRole === 'admin' || meRole === 'manager';

  const [form, setForm] = useState({
    company_name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    tax_id: '',
    notes: '',
    credit_limit: '',
    payment_terms: 'Net 30',
  });

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function validate() {
    if (!form.company_name.trim()) return 'Company name is required.';
    if (!form.contact_person.trim()) return 'Contact person is required.';
    if (!form.phone.trim()) return 'Phone is required.';

    const email = form.email.trim().toLowerCase();
    if (!email) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email format is invalid.';

    if (isAdminOrManager && form.credit_limit.trim()) {
      const n = parseFloat(form.credit_limit);
      if (!Number.isFinite(n) || n < 0) return 'Credit limit must be a valid number >= 0.';
    }

    return '';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');

    const v = validate();
    if (v) return setErr(v);

    setSaving(true);

    const payload: any = {
      company_name: form.company_name.trim(),
      contact_person: form.contact_person.trim(),
      phone: form.phone.trim(),
      email: form.email.trim().toLowerCase(),
      address: form.address.trim(),
      tax_id: form.tax_id.trim(),
      notes: form.notes.trim(),
    };

    if (isAdminOrManager) {
      payload.credit_limit = form.credit_limit.trim() ? parseFloat(form.credit_limit) : 0;
      payload.payment_terms = form.payment_terms.trim() || 'Net 30';
    }

    const resp = await apiClient.post('/api/clients', payload);
    const apiErr =
      (resp?.success === false ? String(resp?.error || resp?.message || 'Failed to create client') : null);

    if (apiErr) {
      setErr(apiErr);
      setSaving(false);
      return;
    }

    await onSaved();
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Add Client</h2>

          {err && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div>{err}</div>
            </div>
          )}
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company name *</label>
            <input
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              maxLength={200}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact person *</label>
            <input
              value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              maxLength={200}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                maxLength={50}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                maxLength={254}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              maxLength={500}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax ID</label>
              <input
                value={form.tax_id}
                onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                maxLength={100}
              />
            </div>

            {isAdminOrManager && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Credit limit</label>
                <input
                  value={form.credit_limit}
                  onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="0"
                />
              </div>
            )}
          </div>

          {isAdminOrManager && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment terms</label>
              <input
                value={form.payment_terms}
                onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                maxLength={50}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
