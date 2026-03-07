// apps/web/src/pages/AdminPricingPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { Branch } from '@weighbridge/shared';
import {
  DollarSign,
  Users,
  SlidersHorizontal,
  RefreshCw,
  AlertTriangle,
  Plus,
  Edit2,
  Power,
  Trash2,
} from 'lucide-react';

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp?.error) return String(resp.error);
  if (resp?.success === false) return String(resp.error || resp.message || 'Request failed');
  if (resp?.data?.success === false) return String(resp.data.error || resp.data.message || 'Request failed');
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

function isForbiddenError(msg: string) {
  const m = (msg || '').toLowerCase();
  return m.includes('forbidden') || m.includes('403') || m.includes('request failed (403)');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function money(v: any) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function toNumOrNull(v: string): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function toNumOrZero(v: string): number {
  const s = (v ?? '').trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

type ClientLite = { id: string; company_name: string };

type PricingRuleRow = {
  id: string;
  branch_id: string;
  name: string;
  material_type: string | null;
  client_id: string | null;
  vehicle_type: string | null;
  min_weight: number | null;
  max_weight: number | null;
  price_per_unit: number;   
  unit_type: string | null; 
  is_active: boolean;
  priority: number;
  effective_from: string;
  effective_until: string | null;
  created_at?: string;
  updated_at?: string;
};

type PricingTab = 'standard' | 'negotiated' | 'advanced';

export default function AdminPricingPage() {
  const { user } = useAuth();
  const role = user?.role || '';
  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const canManage = isAdmin || isManager;

  const [tab, setTab] = useState<PricingTab>('standard');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesError, setBranchesError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadBranches();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function loadBranches() {
    setBranchesError('');
    setAccessDenied(false);

    try {
      const resp = await apiClient.get('/api/branches');
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) {
        setBranches([]);
        setBranchesError(String(err || 'Failed to load branches'));
        if (isForbiddenError(err)) setAccessDenied(true);
        return;
      }

      const list = unwrapArray<Branch>(resp);
      setBranches(Array.isArray(list) ? list : []);
    } catch (e: any) {
      if (!mountedRef.current) return;
      const msg = String(e?.message || 'Failed to load branches');
      setBranches([]);
      setBranchesError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
    }
  }

  if (!canManage) {
    return (
      <div className="p-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 mt-0.5" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Access Restricted</h1>
              <p className="text-gray-600 mt-1">Only admin/manager can manage pricing.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-gray-900">Pricing Management</h1>
        <p className="text-gray-600 mt-1">
          Standard prices (no client), negotiated prices (per client), and advanced view for all rules.
        </p>

        {!!branchesError && (
          <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
            Branch list warning: {branchesError}
          </div>
        )}

        {accessDenied && (
          <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
            Your account does not have permission to view branches/pricing.
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="flex border-b border-gray-200">
          <TabBtn active={tab === 'standard'} onClick={() => setTab('standard')} icon={<DollarSign className="w-4 h-4" />}>
            Standard Prices
          </TabBtn>
          <TabBtn active={tab === 'negotiated'} onClick={() => setTab('negotiated')} icon={<Users className="w-4 h-4" />}>
            Negotiated Prices
          </TabBtn>
          <TabBtn active={tab === 'advanced'} onClick={() => setTab('advanced')} icon={<SlidersHorizontal className="w-4 h-4" />}>
            Advanced (All Rules)
          </TabBtn>
        </div>
      </div>

      {tab === 'standard' && <RulesTab mode="standard" isAdmin={isAdmin} branches={branches} />}
      {tab === 'negotiated' && <NegotiatedRulesTab isAdmin={isAdmin} branches={branches} />}
      {tab === 'advanced' && <RulesTab mode="advanced" isAdmin={isAdmin} branches={branches} />}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 px-4 text-sm font-medium inline-flex items-center justify-center gap-2 ${
        active ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function RulesTab({
  mode,
  isAdmin,
  branches,
}: {
  mode: 'standard' | 'advanced';
  isAdmin: boolean;
  branches: Branch[];
}) {
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [branchId, setBranchId] = useState('');
  const [limit, setLimit] = useState(300);

  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [rules, setRules] = useState<PricingRuleRow[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PricingRuleRow | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const branchLabel = (id: string) => branches.find((b: any) => b.id === id)?.name || id;

  async function load() {
    setLoading(true);
    setPageError('');
    setAccessDenied(false);
    const qs = new URLSearchParams();
    qs.set('active', activeOnly ? 'true' : 'false');
    qs.set('limit', String(limit || 300));
    if (q.trim()) qs.set('q', q.trim());
    if (branchId.trim()) qs.set('branch_id', branchId.trim());

    try {
      const resp = await apiClient.get(`/api/pricingRules?${qs.toString()}`);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) {
        setRules([]);
        setPageError(err);
        if (isForbiddenError(err)) setAccessDenied(true);
        return;
      }

      setRules(unwrapArray<PricingRuleRow>(resp));
    } catch (e: any) {
      if (!mountedRef.current) return;
      const msg = String(e?.message || 'Failed to load rules');
      setRules([]);
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  const filteredRules = useMemo(() => {
    const base = mode === 'standard'
      ? rules.filter((r) => !r.client_id) 
      : rules; 

    const term = q.trim().toLowerCase();
    if (!term) return base;

    const norm = (v: any) => String(v ?? '').toLowerCase();
    return base.filter((r) => {
      const fields = [
        r.name,
        r.material_type,
        r.vehicle_type,
        r.unit_type,
        r.client_id,
        r.branch_id,
        branchLabel(r.branch_id),
        r.effective_from,
        r.effective_until,
        r.min_weight,
        r.max_weight,
        r.price_per_unit,
        r.priority,
      ];
      return fields.some((f) => norm(f).includes(term));
    });
  }, [rules, q, branches, mode]);

  async function toggleRule(r: PricingRuleRow) {
    const resp = await apiClient.patch(`/api/pricingRules/${r.id}/status`, { is_active: !r.is_active });
    const err = pickErrorMessage(resp);
    if (err) {
      setPageError(err);
      return;
    }
    await load();
  }

  async function deleteRule(r: PricingRuleRow) {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    const resp = await apiClient.delete(`/api/pricingRules/${r.id}`);
    const err = pickErrorMessage(resp);
    if (err) {
      setPageError(err);
      return;
    }
    await load();
  }

  return (
    <div className="space-y-4">
      <FilterCard>
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">Search</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load();
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              placeholder="Search name/material/vehicle/unit/weights/price/priority..."
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">&nbsp;</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
              Active only
            </label>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">Branch filter</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={!isAdmin}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white disabled:bg-gray-50"
            >
              {!isAdmin ? (
                <option value="">My branch</option>
              ) : (
                <>
                  <option value="">{mode === 'standard' ? 'All branches (standard)' : 'All branches (advanced)'}</option>
                  {branches.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Limit</label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              min={1}
              max={800}
            />
          </div>

          <div className="flex gap-2 lg:col-span-7 justify-end">
            <button
              onClick={() => {
                setEditing(null);
                setShowModal(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              disabled={loading}
            >
              <Plus className="w-4 h-4" />
              {mode === 'standard' ? 'Add Standard Price' : 'Add Rule'}
            </button>

            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
              disabled={loading}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>

            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              disabled={loading}
            >
              Apply
            </button>
          </div>
        </div>

        {!!pageError && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 mt-0.5" />
            <div>{pageError}</div>
          </div>
        )}
        {accessDenied && (
          <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
            Your account does not have permission to view pricing rules.
          </div>
        )}
      </FilterCard>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">
            {mode === 'standard' ? 'Standard prices (no client)' : 'All pricing rules'}
          </div>
          <div className="text-sm text-gray-500">
            {loading ? 'Loading...' : `${filteredRules.length} shown`}
            {!loading && filteredRules.length !== rules.length ? ` (filtered from ${rules.length})` : ''}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Name</th>
                <th className="text-left font-medium px-6 py-3">Branch</th>
                <th className="text-left font-medium px-6 py-3">Applies to</th>
                {mode === 'advanced' && <th className="text-left font-medium px-6 py-3">Client</th>}
                <th className="text-right font-medium px-6 py-3">Base amount</th>
                <th className="text-left font-medium px-6 py-3">Unit</th>
                <th className="text-left font-medium px-6 py-3">Active</th>
                <th className="text-right font-medium px-6 py-3">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!loading && filteredRules.length === 0 && (
                <tr>
                  <td colSpan={mode === 'advanced' ? 8 : 7} className="px-6 py-8 text-gray-500">
                    No pricing rules found.
                  </td>
                </tr>
              )}

              {filteredRules.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <div className="font-medium text-gray-900">{r.name}</div>
                    <div className="text-xs text-gray-500">
                      Priority: {r.priority} • From: {r.effective_from} {r.effective_until ? `• Until: ${r.effective_until}` : ''}
                    </div>
                  </td>

                  <td className="px-6 py-3 text-gray-700">{branchLabel(r.branch_id)}</td>

                  <td className="px-6 py-3 text-gray-700">
                    <div className="text-xs">
                      {r.material_type ? `Material: ${r.material_type}` : 'Material: —'} •{' '}
                      {r.vehicle_type ? `Vehicle: ${r.vehicle_type}` : 'Vehicle: —'} •{' '}
                      {r.min_weight != null || r.max_weight != null
                        ? `Range: ${r.min_weight ?? '—'} - ${r.max_weight ?? '—'}`
                        : 'Range: —'}
                    </div>
                  </td>

                  {mode === 'advanced' && (
                    <td className="px-6 py-3 text-gray-700">
                      {r.client_id ? <span className="font-mono text-xs">{r.client_id.slice(0, 8)}…</span> : '—'}
                    </td>
                  )}

                  <td className="px-6 py-3 text-right text-gray-900">${money(r.price_per_unit)}</td>
                  <td className="px-6 py-3 text-gray-700">{r.unit_type || '—'}</td>

                  <td className="px-6 py-3">
                    {r.is_active ? <Badge color="green">Yes</Badge> : <Badge color="gray">No</Badge>}
                  </td>

                  <td className="px-6 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="inline-flex items-center gap-1 px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
                        onClick={() => {
                          setEditing(r);
                          setShowModal(true);
                        }}
                      >
                        <Edit2 className="w-4 h-4" /> Edit
                      </button>

                      <button
                        className="inline-flex items-center gap-1 px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
                        onClick={() => void toggleRule(r)}
                        title="Toggle active"
                      >
                        <Power className="w-4 h-4" /> {r.is_active ? 'Disable' : 'Enable'}
                      </button>

                      <button
                        className="inline-flex items-center gap-1 px-3 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50"
                        onClick={() => void deleteRule(r)}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <RuleModal
          mode={mode}
          isAdmin={isAdmin}
          branches={branches}
          rule={editing}
          defaultBranchId={branchId}
          fixedClientId={mode === 'standard' ? null : undefined}
          onClose={() => {
            setShowModal(false);
            setEditing(null);
          }}
          onSaved={load}
        />
      )}
    </div>
  );
}


function NegotiatedRulesTab({ isAdmin, branches }: { isAdmin: boolean; branches: Branch[] }) {
  const [branchId, setBranchId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const selectedClient = useMemo(() => clients.find((c) => c.id === selectedClientId), [clients, selectedClientId]);
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [limit, setLimit] = useState(400);
  const [loading, setLoading] = useState(false);
  const [searchingClients, setSearchingClients] = useState(false);
  const [pageError, setPageError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [rules, setRules] = useState<PricingRuleRow[]>([]);
  const [openSuggestions, setOpenSuggestions] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PricingRuleRow | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadClients('');
    void loadRules();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadClients(clientQuery), 250);
    return () => clearTimeout(t);
  }, [clientQuery, branchId, isAdmin]);

  async function loadClients(qText: string) {
    if (!mountedRef.current) return;
    setAccessDenied(false);
    setPageError('');
    setSearchingClients(true);
    const qs = new URLSearchParams();
    qs.set('limit', '50');
    if (qText.trim()) qs.set('q', qText.trim());
    if (isAdmin && branchId.trim()) qs.set('branch_id', branchId.trim());

    try {
      const resp = await apiClient.get(`/api/pricing/clients?${qs.toString()}`);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) {
        setClients([]);
        setPageError(err);
        if (isForbiddenError(err)) setAccessDenied(true);
        return;
      }

      setClients(unwrapArray<ClientLite>(resp));
    } catch (e: any) {
      if (!mountedRef.current) return;
      const msg = String(e?.message || 'Failed to load clients');
      setClients([]);
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
    } finally {
      if (mountedRef.current) setSearchingClients(false);
    }
  }

  async function loadRules(opts?: { clientId?: string }) {
    setLoading(true);
    setPageError('');
    setAccessDenied(false);

    const effectiveClientId = (opts?.clientId ?? selectedClientId).trim();
    if (!effectiveClientId) {
      setRules([]);
      setLoading(false);
      return;
    }

    const qs = new URLSearchParams();
    qs.set('active', activeOnly ? 'true' : 'false');
    qs.set('limit', String(limit || 400));
    qs.set('client_id', effectiveClientId); 

    if (q.trim()) qs.set('q', q.trim());
    if (branchId.trim()) qs.set('branch_id', branchId.trim()); 

    try {
      const resp = await apiClient.get(`/api/pricingRules?${qs.toString()}`);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) {
        setRules([]);
        setPageError(err);
        if (isForbiddenError(err)) setAccessDenied(true);
        return;
      }

      setRules(unwrapArray<PricingRuleRow>(resp));
    } catch (e: any) {
      if (!mountedRef.current) return;
      const msg = String(e?.message || 'Failed to load rules');
      setRules([]);
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }


  const branchLabel = (id: string) => branches.find((b: any) => b.id === id)?.name || id;

  const negotiatedForClient = useMemo(() => {
    const base = rules; 

    const term = q.trim().toLowerCase();
    if (!term) return base;

    const norm = (v: any) => String(v ?? '').toLowerCase();
    return base.filter((r) => {
      const fields = [
        r.name,
        r.material_type,
        r.vehicle_type,
        r.unit_type,
        r.branch_id,
        branchLabel(r.branch_id),
        r.effective_from,
        r.effective_until,
        r.min_weight,
        r.max_weight,
        r.price_per_unit,
        r.priority,
      ];
      return fields.some((f) => norm(f).includes(term));
    });
  }, [rules, q, branches]);

  function selectClient(c: ClientLite) {
    setSelectedClientId(c.id);
    setClientQuery(c.company_name);
    setOpenSuggestions(false);
    void loadRules({ clientId: c.id }); 
  }


  function clearSelection() {
    setSelectedClientId('');
    setClientQuery('');
    setOpenSuggestions(false);
  }

  async function toggleRule(r: PricingRuleRow) {
    const resp = await apiClient.patch(`/api/pricingRules/${r.id}/status`, { is_active: !r.is_active });
    const err = pickErrorMessage(resp);
    if (err) {
      setPageError(err);
      return;
    }
    await loadRules();
  }

  async function deleteRule(r: PricingRuleRow) {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    const resp = await apiClient.delete(`/api/pricingRules/${r.id}`);
    const err = pickErrorMessage(resp);
    if (err) {
      setPageError(err);
      return;
    }
    await loadRules();
  }

  return (
    <div className="space-y-4">
      <FilterCard>
        <div className="grid grid-cols-1 lg:grid-cols-8 gap-3 items-end">
          <div className="lg:col-span-3">
            <label className="block text-sm text-gray-600 mb-1">Select client (negotiated pricing)</label>
            <div className="relative">
              <input
                value={clientQuery}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  setOpenSuggestions(true);
                }}
                onFocus={() => setOpenSuggestions(true)}
                onBlur={() => setTimeout(() => setOpenSuggestions(false), 150)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="Type a client name… or paste UUID…"
              />

              {selectedClientId && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                >
                  Clear
                </button>
              )}

              {openSuggestions && clients.length > 0 && (
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
            <div className="text-xs text-gray-500 mt-1">
              {searchingClients ? 'Searching…' : ''}
            </div>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">Branch filter</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={!isAdmin}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white disabled:bg-gray-50"
            >
              {!isAdmin ? (
                <option value="">My branch</option>
              ) : (
                <>
                  <option value="">All branches</option>
                  {branches.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">Search within client rules</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadRules();
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              placeholder="Search name/material/vehicle/unit/weights..."
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">&nbsp;</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
              Active only
            </label>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Limit</label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              min={1}
              max={800}
            />
          </div>

          <div className="flex gap-2 lg:col-span-8 justify-end">
            <button
              onClick={() => {
                setEditing(null);
                setShowModal(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={loading || !selectedClientId}
              title={!selectedClientId ? 'Select a client first' : 'Add negotiated price'}
            >
              <Plus className="w-4 h-4" />
              Add Negotiated Price
            </button>

            <button
              onClick={() => void loadRules()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
              disabled={loading}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>

            <button
              onClick={() => void loadRules()}
              className="inline-flex items-center gap-2 px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              disabled={loading}
            >
              Apply
            </button>
          </div>
        </div>

        {!!pageError && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 mt-0.5" />
            <div>{pageError}</div>
          </div>
        )}
        {accessDenied && (
          <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
            Your account does not have permission to view pricing rules.
          </div>
        )}
      </FilterCard>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-gray-900">Negotiated prices (per client)</div>
            <div className="text-sm text-gray-500">
              {!selectedClientId
                ? 'Select a client to view their negotiated rules.'
                : `${negotiatedForClient.length} rule(s) for ${selectedClient?.company_name || selectedClientId}`}
            </div>
          </div>
          {selectedClientId && (
            <div className="text-xs text-gray-600">
              Client ID: <span className="font-mono">{selectedClientId}</span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Name</th>
                <th className="text-left font-medium px-6 py-3">Branch</th>
                <th className="text-left font-medium px-6 py-3">Applies to</th>
                <th className="text-right font-medium px-6 py-3">Base amount</th>
                <th className="text-left font-medium px-6 py-3">Unit</th>
                <th className="text-left font-medium px-6 py-3">Active</th>
                <th className="text-right font-medium px-6 py-3">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!loading && selectedClientId && negotiatedForClient.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-gray-500">
                    No negotiated pricing rules found for this client.
                  </td>
                </tr>
              )}

              {!selectedClientId && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-gray-500">
                    Select a client above to see negotiated rules.
                  </td>
                </tr>
              )}

              {negotiatedForClient.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <div className="font-medium text-gray-900">{r.name}</div>
                    <div className="text-xs text-gray-500">
                      Priority: {r.priority} • From: {r.effective_from} {r.effective_until ? `• Until: ${r.effective_until}` : ''}
                    </div>
                  </td>

                  <td className="px-6 py-3 text-gray-700">{branchLabel(r.branch_id)}</td>

                  <td className="px-6 py-3 text-gray-700">
                    <div className="text-xs">
                      {r.material_type ? `Material: ${r.material_type}` : 'Material: —'} •{' '}
                      {r.vehicle_type ? `Vehicle: ${r.vehicle_type}` : 'Vehicle: —'} •{' '}
                      {r.min_weight != null || r.max_weight != null
                        ? `Range: ${r.min_weight ?? '—'} - ${r.max_weight ?? '—'}`
                        : 'Range: —'}
                    </div>
                  </td>

                  <td className="px-6 py-3 text-right text-gray-900">${money(r.price_per_unit)}</td>
                  <td className="px-6 py-3 text-gray-700">{r.unit_type || '—'}</td>
                  <td className="px-6 py-3">{r.is_active ? <Badge color="green">Yes</Badge> : <Badge color="gray">No</Badge>}</td>

                  <td className="px-6 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="inline-flex items-center gap-1 px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
                        onClick={() => {
                          setEditing(r);
                          setShowModal(true);
                        }}
                      >
                        <Edit2 className="w-4 h-4" /> Edit
                      </button>

                      <button
                        className="inline-flex items-center gap-1 px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
                        onClick={() => void toggleRule(r)}
                        title="Toggle active"
                      >
                        <Power className="w-4 h-4" /> {r.is_active ? 'Disable' : 'Enable'}
                      </button>

                      <button
                        className="inline-flex items-center gap-1 px-3 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50"
                        onClick={() => void deleteRule(r)}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <RuleModal
          mode="negotiated"
          isAdmin={isAdmin}
          branches={branches}
          rule={editing}
          defaultBranchId={branchId}
          fixedClientId={selectedClientId || null}
          fixedClientLabel={selectedClient?.company_name || undefined}
          onClose={() => {
            setShowModal(false);
            setEditing(null);
          }}
          onSaved={loadRules}
        />
      )}
    </div>
  );
}

function RuleModal({
  mode,
  isAdmin,
  branches,
  rule,
  defaultBranchId,
  fixedClientId,
  fixedClientLabel,
  onClose,
  onSaved,
}: {
  mode: 'standard' | 'negotiated' | 'advanced';
  isAdmin: boolean;
  branches: Branch[];
  rule: PricingRuleRow | null;
  defaultBranchId: string;
  fixedClientId?: string | null;
  fixedClientLabel?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const initialClientId =
    typeof fixedClientId !== 'undefined'
      ? fixedClientId
      : (rule?.client_id ?? null);

  const [form, setForm] = useState(() => ({
    branch_id: rule?.branch_id || defaultBranchId || '',
    name: rule?.name || '',
    material_type: rule?.material_type || '',
    vehicle_type: rule?.vehicle_type || '',
    client_id: rule?.client_id || '',
    min_weight: rule?.min_weight == null ? '' : String(rule.min_weight),
    max_weight: rule?.max_weight == null ? '' : String(rule.max_weight),
    price_per_unit: String(rule?.price_per_unit ?? 0),
    unit_type: (rule?.unit_type || 'kg') as string,
    priority: String(rule?.priority ?? 0),
    is_active: rule?.is_active ?? true,
    effective_from: rule?.effective_from || todayISO(),
    effective_until: rule?.effective_until || '',
  }));

  useEffect(() => {
    if (mode === 'negotiated' && initialClientId) {
      setForm((p) => ({ ...p, client_id: initialClientId }));
    }
    if (mode === 'standard') {
      setForm((p) => ({ ...p, client_id: '' }));
    }
  }, []);

  function normalizeUnit(u: string) {
    const x = (u || '').trim().toLowerCase();
    if (!x) return 'kg';
    if (x === 'kg' || x === 'ton' || x === 'lb' || x === 'mattress' || x === 'count') return x;
    return x; 
  }

  async function save() {
    setErr('');
    setSaving(true);

    try {
      if (!form.name.trim()) throw new Error('Name is required');
      if (isAdmin && !form.branch_id.trim()) throw new Error('Branch is required (admin without assignment)');
      if (mode === 'negotiated' && !initialClientId) {
        throw new Error('Select a client first (negotiated pricing)');
      }

      const minW = toNumOrNull(form.min_weight);
      const maxW = toNumOrNull(form.max_weight);

      if (minW != null && maxW != null && minW > maxW) {
        throw new Error('Invalid range: min weight cannot be greater than max weight');
      }

      const payload: any = {
        branch_id: form.branch_id || undefined,
        name: form.name.trim(),
        material_type: form.material_type.trim() || null,
        vehicle_type: form.vehicle_type.trim() || null,
        min_weight: minW,
        max_weight: maxW,
        price_per_unit: toNumOrZero(form.price_per_unit),
        unit_type: normalizeUnit(form.unit_type),
        priority: toNumOrZero(form.priority),
        is_active: !!form.is_active,
        effective_from: form.effective_from,
        effective_until: form.effective_until || null,
      };

      if (mode === 'standard') {
        payload.client_id = null;
      } else if (mode === 'negotiated') {
        payload.client_id = initialClientId;
      } else {
        payload.client_id = form.client_id.trim() || null;
      }

      const resp = rule
        ? await apiClient.put(`/api/pricingRules/${rule.id}`, payload)
        : await apiClient.post(`/api/pricingRules`, payload);

      const e = pickErrorMessage(resp);
      if (e) throw new Error(e);

      await onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={
        rule
          ? 'Edit Pricing Rule'
          : mode === 'standard'
            ? 'Add Standard Price (Bracket)'
            : mode === 'negotiated'
              ? 'Add Negotiated Price (Client Bracket)'
              : 'Add Pricing Rule'
      }
      onClose={onClose}
    >
      {err && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>{err}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {isAdmin && (
          <div>
            <label className="block text-sm text-gray-600 mb-1">Branch</label>
            <select
              value={form.branch_id}
              onChange={(e) => setForm((p) => ({ ...p, branch_id: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="">Select branch…</option>
              {branches.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === 'negotiated' && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
            <div className="text-gray-600">Client</div>
            <div className="font-semibold text-gray-900">
              {fixedClientLabel || 'Selected client'}
            </div>
            <div className="font-mono text-xs text-gray-600">{initialClientId}</div>
          </div>
        )}

        {mode === 'advanced' && (
          <div>
            <label className="block text-sm text-gray-600 mb-1">Client ID (optional UUID)</label>
            <input
              value={form.client_id}
              onChange={(e) => setForm((p) => ({ ...p, client_id: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm"
              placeholder="uuid…"
            />
            <div className="text-xs text-gray-500 mt-1">
              Leave empty for standard pricing; set UUID for negotiated pricing.
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-600 mb-1">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
            placeholder="e.g. Net weight > 5000kg"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FieldText label="Material type (optional)" value={form.material_type} onChange={(v) => setForm((p) => ({ ...p, material_type: v }))} />
          <FieldText label="Vehicle type (optional)" value={form.vehicle_type} onChange={(v) => setForm((p) => ({ ...p, vehicle_type: v }))} />

          <div>
            <label className="block text-sm text-gray-600 mb-1">Unit type</label>
            <select
              value={form.unit_type || 'kg'}
              onChange={(e) => setForm((p) => ({ ...p, unit_type: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="kg">kg</option>
              <option value="ton">ton</option>
              <option value="lb">lb</option>
              <option value="mattress">mattress</option>
              <option value="count">count</option>
            </select>
            <div className="text-xs text-gray-500 mt-1">
              Use <b>kg</b> for weight-based pricing, <b>mattress/count</b> for quantity-based pricing.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FieldNumericText label="Min (optional)" value={form.min_weight} onChange={(v) => setForm((p) => ({ ...p, min_weight: v }))} />
          <FieldNumericText label="Max (optional)" value={form.max_weight} onChange={(v) => setForm((p) => ({ ...p, max_weight: v }))} />
          <FieldNumericText
            label="Base amount ($)"
            value={form.price_per_unit}
            onChange={(v) => setForm((p) => ({ ...p, price_per_unit: v }))}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FieldNumericText label="Priority" value={form.priority} onChange={(v) => setForm((p) => ({ ...p, priority: v }))} inputMode="numeric" />
          <div>
            <label className="block text-sm text-gray-600 mb-1">Effective from</label>
            <input
              type="date"
              value={form.effective_from}
              onChange={(e) => setForm((p) => ({ ...p, effective_from: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Effective until (optional)</label>
            <input
              type="date"
              value={form.effective_until}
              onChange={(e) => setForm((p) => ({ ...p, effective_until: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
          Active
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FilterCard({ children }: { children: React.ReactNode }) {
  return <div className="bg-white border border-gray-200 rounded-xl p-4">{children}</div>;
}

function Badge({ color, children }: { color: 'green' | 'blue' | 'gray'; children: React.ReactNode }) {
  const cls =
    color === 'green'
      ? 'bg-green-100 text-green-700'
      : color === 'blue'
        ? 'bg-blue-100 text-blue-700'
        : 'bg-gray-100 text-gray-700';
  return <span className={`px-2 py-1 text-xs rounded-full ${cls}`}>{children}</span>;
}

function FieldNumericText({
  label,
  value,
  onChange,
  inputMode = 'decimal',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(',', '.'))}
        className="w-full border border-gray-300 rounded-lg px-3 py-2"
        placeholder="—"
      />
    </div>
  );
}

function FieldText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div className="font-semibold text-gray-900">{title}</div>
          <button className="text-gray-500 hover:text-gray-900" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
