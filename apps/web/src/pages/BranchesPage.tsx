import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Branch } from '@weighbridge/shared';
import { Building2, Plus, Edit2, Power, Search, AlertTriangle, RefreshCcw } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';

type Role = 'operator' | 'admin' | 'manager';

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp.error) return String(resp.error);
  if (resp.success === false) return String(resp.error || resp.message || 'Request failed');
  if (resp?.data?.success === false) return String(resp?.data?.error || resp?.data?.message || 'Request failed');
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

function isForbiddenOrUnauthorized(msg: string) {
  const m = (msg || '').toLowerCase();
  return (
    m.includes('forbidden') ||
    m.includes('unauthorized') ||
    m.includes('401') ||
    m.includes('403') ||
    m.includes('request failed (401)') ||
    m.includes('request failed (403)')
  );
}

type BranchKeys = {
  nameKey: 'name' | 'branch_name';
  codeKey: 'code' | 'branch_code';
  activeKey: 'is_active' | 'active' | 'isActive';
};

function detectBranchKeys(list: any[]): BranchKeys {
  const sample = list?.find(Boolean) ?? {};
  const nameKey: BranchKeys['nameKey'] = 'branch_name' in sample ? 'branch_name' : 'name';
  const codeKey: BranchKeys['codeKey'] = 'branch_code' in sample ? 'branch_code' : 'code';

  let activeKey: BranchKeys['activeKey'] = 'is_active';
  if ('active' in sample) activeKey = 'active';
  if ('isActive' in sample) activeKey = 'isActive';

  return { nameKey, codeKey, activeKey };
}

function getBranchName(b: any): string {
  return String(b?.name ?? b?.branch_name ?? '').trim();
}
function getBranchCode(b: any): string {
  return String(b?.code ?? b?.branch_code ?? '').trim();
}
function getBranchActive(b: any): boolean {
  if (typeof b?.is_active === 'boolean') return b.is_active;
  if (typeof b?.isActive === 'boolean') return b.isActive;
  if (typeof b?.active === 'boolean') return b.active;
  return false;
}

export default function BranchesPage() {
  const mountedRef = useRef(true);

  const { user, profile } = useAuth();
  const role = (user?.role || (profile as any)?.role || 'operator') as Role;
  const isAdminOrManager = role === 'admin' || role === 'manager';
  const [branches, setBranches] = useState<Branch[]>([]);
  const [keys, setKeys] = useState<BranchKeys>({ nameKey: 'name', codeKey: 'code', activeKey: 'is_active' });
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string>('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  const loadBranches = useCallback(async () => {
    setLoading(true);
    setPageError('');
    setAccessDenied(false);

    try {
      const resp = await apiClient.get('/api/branches?limit=200');
      const err = pickErrorMessage(resp);

      if (!mountedRef.current) return;

      if (err) {
        setBranches([]);
        setPageError(err);
        if (isForbiddenOrUnauthorized(err)) setAccessDenied(true);
        return;
      }

      const list = unwrapArray<any>(resp);
      setKeys(detectBranchKeys(list));
      setBranches(list as Branch[]);
    } catch (e: any) {
      if (!mountedRef.current) return;
      const msg = String(e?.message || 'Failed to load branches');
      setBranches([]);
      setPageError(msg);
      if (isForbiddenOrUnauthorized(msg)) setAccessDenied(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!isAdminOrManager) {
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    void loadBranches();
    return () => {
      mountedRef.current = false;
    };
  }, [isAdminOrManager, loadBranches]);

  const toggleBranchStatus = useCallback(
    async (branch: Branch) => {
      setPageError('');
      setAccessDenied(false);

      const current = getBranchActive(branch as any);
      const action = current ? 'deactivate' : 'activate';

      const ok = window.confirm(`Are you sure you want to ${action} this branch?`);
      if (!ok) return;

      try {
        const body: any = {};
        body[keys.activeKey] = !current;
        const id = encodeURIComponent(String((branch as any).id));
        const resp = await apiClient.patch(`/api/branches/${id}/status`, body);
        const err = pickErrorMessage(resp);
        if (err) {
          setPageError(err);
          if (isForbiddenOrUnauthorized(err)) setAccessDenied(true);
          return;
        }

        await loadBranches();

        try {
          window.dispatchEvent(new CustomEvent('wb:branches:changed'));
        } catch {
          // ignore
        }
      } catch (e: any) {
        const msg = String(e?.message || 'Failed to update branch status');
        setPageError(msg);
        if (isForbiddenOrUnauthorized(msg)) setAccessDenied(true);
      }
    },
    [keys.activeKey, loadBranches]
  );

  const filteredBranches = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return branches;

    return branches.filter((b: any) => {
      const name = getBranchName(b).toLowerCase();
      const code = getBranchCode(b).toLowerCase();
      const address = String(b?.address || '').toLowerCase();
      return name.includes(q) || code.includes(q) || address.includes(q);
    });
  }, [branches, searchTerm]);

  if (!isAdminOrManager) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 mt-0.5" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Access Restricted</h1>
              <p className="text-gray-600 mt-1">
                Only <span className="font-medium">admin</span> and <span className="font-medium">manager</span> accounts can manage branches.
              </p>
              <p className="text-gray-500 mt-2 text-sm">If you believe this is wrong, ask an admin to adjust your role.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6 gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Branch Management</h1>
          <p className="text-gray-600 mt-1">Manage weighbridge locations</p>

          {pageError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div>{pageError}</div>
            </div>
          )}

          {accessDenied && (
            <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
              Your account does not have permission to manage branches.
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadBranches()}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white text-gray-800 rounded-lg hover:bg-gray-50"
          >
            <RefreshCcw className="w-4 h-4" />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingBranch(null);
              setShowModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Branch
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 mb-6 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search branches..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="mt-3 text-sm text-gray-600">
          Showing <span className="font-medium text-gray-900">{filteredBranches.length}</span> branch(es) (loaded {branches.length})
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredBranches.map((branch: any) => {
          const active = getBranchActive(branch);
          const name = getBranchName(branch) || `Branch ${String(branch?.id || '')}`;
          const code = getBranchCode(branch) || '—';

          return (
            <div
              key={String(branch.id)}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-blue-600" />
                </div>
                <span
                  className={`px-2 py-1 text-xs rounded-full ${
                    active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <h3 className="text-xl font-bold text-gray-900 mb-1">{name}</h3>
              <p className="text-sm text-gray-600 mb-4">Code: {code}</p>

              <div className="space-y-2 mb-4 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-gray-600">Address:</span>
                  <span className="text-gray-900 flex-1">{String(branch.address || '') || 'Not set'}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-gray-600">Phone:</span>
                  <span className="text-gray-900">{String(branch.phone || '') || 'Not set'}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-gray-600">Email:</span>
                  <span className="text-gray-900">{String(branch.email || '') || 'Not set'}</span>
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setEditingBranch(branch as Branch);
                    setShowModal(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </button>

                <button
                  type="button"
                  onClick={() => void toggleBranchStatus(branch as Branch)}
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg ${
                    active ? 'bg-gray-50 text-gray-600 hover:bg-gray-100' : 'bg-green-50 text-green-600 hover:bg-green-100'
                  }`}
                  title={active ? 'Deactivate' : 'Activate'}
                >
                  <Power className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredBranches.length === 0 && (
        <div className="text-center py-12">
          <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No branches found</p>
        </div>
      )}

      {showModal && (
        <BranchModal
          branch={editingBranch}
          keys={keys}
          onClose={() => {
            setShowModal(false);
            setEditingBranch(null);
          }}
          onSaved={async () => {
            await loadBranches();
            try {
              window.dispatchEvent(new CustomEvent('wb:branches:changed'));
            } catch {
              // ignore
            }
          }}
          setPageError={setPageError}
          setAccessDenied={setAccessDenied}
        />
      )}
    </div>
  );
}

function BranchModal({
  branch,
  keys,
  onClose,
  onSaved,
  setPageError,
  setAccessDenied,
}: {
  branch: Branch | null;
  keys: BranchKeys;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  setPageError: (v: string) => void;
  setAccessDenied: (v: boolean) => void;
}) {
  const b: any = branch;

  const buildInitial = useCallback(() => {
    const initialName = String(b?.[keys.nameKey] ?? b?.name ?? b?.branch_name ?? '');
    const initialCode = String(b?.[keys.codeKey] ?? b?.code ?? b?.branch_code ?? '');
    const initialActive = getBranchActive(b);

    return {
      name: initialName,
      code: initialCode,
      address: String(b?.address ?? ''),
      phone: String(b?.phone ?? ''),
      email: String(b?.email ?? ''),
      is_active: branch ? initialActive : true,
    };
  }, [b, branch, keys.codeKey, keys.nameKey]);

  const [formData, setFormData] = useState(() => buildInitial());
  const [loading, setLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    setFormData(buildInitial());
  }, [buildInitial]);

  function normalizeBeforeSend() {
    const name = String(formData.name || '').trim();
    const code = String(formData.code || '').trim().toUpperCase();
    const address = String(formData.address || '').trim();
    const phone = String(formData.phone || '').trim();
    const email = String(formData.email || '').trim();
    const is_active = !!formData.is_active;

    return { name, code, address, phone, email, is_active };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setModalError('');
    setPageError('');
    setAccessDenied(false);

    const payload = normalizeBeforeSend();

    if (!payload.name || !payload.code) {
      setModalError('Branch name and code are required.');
      setLoading(false);
      return;
    }
    if (payload.name.length > 120) {
      setModalError('Branch name is too long (max 120).');
      setLoading(false);
      return;
    }
    if (payload.code.length > 20) {
      setModalError('Branch code is too long (max 20).');
      setLoading(false);
      return;
    }

    try {
      const body: any = {
        address: payload.address,
        phone: payload.phone,
        email: payload.email,
      };
      body[keys.nameKey] = payload.name;
      body[keys.codeKey] = payload.code;
      body[keys.activeKey] = payload.is_active;

      const id = branch ? encodeURIComponent(String((branch as any).id)) : '';

      const resp = branch
        ? await apiClient.put(`/api/branches/${id}`, body)
        : await apiClient.post('/api/branches', body);

      const err = pickErrorMessage(resp);
      if (err) {
        setModalError(err);
        if (isForbiddenOrUnauthorized(err)) setAccessDenied(true);
        setLoading(false);
        return;
      }

      await onSaved();
      onClose();
    } catch (e: any) {
      const msg = String(e?.message || 'Failed to save branch');
      setModalError(msg);
      if (isForbiddenOrUnauthorized(msg)) setAccessDenied(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">{branch ? 'Edit Branch' : 'Add Branch'}</h2>
          {modalError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div>{modalError}</div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              maxLength={120}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch Code *</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., BR01"
              required
              maxLength={20}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={2}
              maxLength={500}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={80}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={254}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="is_active" className="text-sm text-gray-700">
              Active
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Branch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
