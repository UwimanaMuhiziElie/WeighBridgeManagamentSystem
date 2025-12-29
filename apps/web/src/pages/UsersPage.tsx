import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, Plus, Search, AlertTriangle, Shield, UserCog, Power, Pencil, RefreshCw } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';

type Role = 'operator' | 'admin' | 'manager';

type SafeUser = {
  id: string;
  email: string;
  full_name?: string | null;
  role: Role;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

function isForbiddenError(msg: string) {
  const m = (msg || '').toLowerCase();
  return m.includes('forbidden') || m.includes('403') || m.includes('request failed (403)');
}

function roleLabel(r: Role) {
  if (r === 'admin') return 'Admin';
  if (r === 'manager') return 'Manager';
  return 'Operator';
}

export default function UsersPage() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  const isManager = user?.role === 'manager';

  const [rows, setRows] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SafeUser | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadUsers();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter, includeInactive]);

  async function loadUsers() {
    setLoading(true);
    setPageError('');
    setAccessDenied(false);

    const qs = new URLSearchParams();
    if (roleFilter) qs.set('role', roleFilter);
    if (includeInactive) qs.set('include_inactive', 'true');

    const resp = await apiClient.get<SafeUser[]>(`/api/users${qs.toString() ? `?${qs.toString()}` : ''}`);

    if (!mountedRef.current) return;

    if ((resp as any)?.error) {
      const msg = String((resp as any).error || 'Failed to load users');
      setRows([]);
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
      setLoading(false);
      return;
    }

    setRows(Array.isArray(resp.data) ? resp.data : []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) => {
      const email = String(u.email || '').toLowerCase();
      const name = String(u.full_name || '').toLowerCase();
      const role = String(u.role || '').toLowerCase();
      return email.includes(q) || name.includes(q) || role.includes(q);
    });
  }, [rows, searchTerm]);

  async function deactivateUser(target: SafeUser) {
    if (!user?.id) return;
    if (target.id === user.id) {
      setPageError('You cannot disable your own account.');
      return;
    }
    const ok = window.confirm(`Disable ${target.email}? (This is a soft delete; they will not be able to log in.)`);
    if (!ok) return;

    setPageError('');
    setAccessDenied(false);

    const resp = await apiClient.delete(`/api/users/${target.id}`);
    if ((resp as any)?.error) {
      const msg = String((resp as any).error || 'Failed to disable user');
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
      return;
    }

    await loadUsers();
  }

  async function reactivateUser(target: SafeUser) {
    setPageError('');
    setAccessDenied(false);

    const resp = await apiClient.put(`/api/users/${target.id}`, { is_active: true });
    if ((resp as any)?.error) {
      const msg = String((resp as any).error || 'Failed to reactivate user');
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
      return;
    }

    await loadUsers();
  }

  // UI-level guard (backend is the real enforcement)
  if (!isAdminOrManager) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 mt-0.5" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Access Restricted</h1>
              <p className="text-gray-600 mt-1">
                Only <span className="font-medium">admin</span> and <span className="font-medium">manager</span> accounts can manage users.
              </p>
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
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          </div>

          <p className="text-gray-600 mt-1">Create, update, disable and reset users</p>

          {pageError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div>{pageError}</div>
            </div>
          )}

          {accessDenied && (
            <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
              Your account does not have permission to manage users.
            </div>
          )}
        </div>

        <button
          onClick={() => {
            setEditing(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 mb-6 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search users by email/name/role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-3 items-center">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter((e.target.value || '') as any)}
            className="px-3 py-2 border border-gray-300 rounded-lg bg-white"
          >
            <option value="">All roles</option>
            <option value="operator">Operator</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Include inactive
          </label>

          <button
            onClick={() => loadUsers()}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-gray-600">
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isMe = u.id === user?.id;
                const roleIcon = u.role === 'admin' ? Shield : u.role === 'manager' ? UserCog : Users;
                const RoleIcon = roleIcon as any;

                // UI safety: managers can’t create admin; and should not edit admin
                const managerBlockedTarget = isManager && u.role === 'admin';

                return (
                  <tr key={u.id} className="border-b last:border-b-0 border-gray-100">
                    <td className="px-5 py-4">
                      <div className="font-medium text-gray-900">{u.full_name || '—'}</div>
                      <div className="text-gray-600">{u.email}</div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-gray-100 text-gray-800">
                        <RoleIcon className="w-4 h-4" />
                        {roleLabel(u.role)}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full ${
                          u.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {isMe && (
                        <span className="ml-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">
                          You
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditing(u);
                            setShowModal(true);
                          }}
                          disabled={managerBlockedTarget}
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border ${
                            managerBlockedTarget
                              ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                          title={managerBlockedTarget ? 'Managers cannot edit admin users' : 'Edit user'}
                        >
                          <Pencil className="w-4 h-4" />
                          Edit
                        </button>

                        {u.is_active ? (
                          <button
                            onClick={() => deactivateUser(u)}
                            disabled={isMe || managerBlockedTarget}
                            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg ${
                              isMe || managerBlockedTarget
                                ? 'bg-gray-50 text-gray-400 border border-gray-200 cursor-not-allowed'
                                : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                            }`}
                            title={isMe ? 'You cannot disable yourself' : 'Disable user'}
                          >
                            <Power className="w-4 h-4" />
                            Disable
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivateUser(u)}
                            disabled={managerBlockedTarget}
                            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg ${
                              managerBlockedTarget
                                ? 'bg-gray-50 text-gray-400 border border-gray-200 cursor-not-allowed'
                                : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                            }`}
                            title="Reactivate user"
                          >
                            <Power className="w-4 h-4" />
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-gray-600">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <UserModal
          meRole={user?.role as Role}
          editing={editing}
          onClose={() => {
            setShowModal(false);
            setEditing(null);
          }}
          onSaved={loadUsers}
          setPageError={setPageError}
          setAccessDenied={setAccessDenied}
        />
      )}
    </div>
  );
}

function UserModal({
  meRole,
  editing,
  onClose,
  onSaved,
  setPageError,
  setAccessDenied,
}: {
  meRole: Role;
  editing: SafeUser | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  setPageError: (v: string) => void;
  setAccessDenied: (v: boolean) => void;
}) {
  const isManager = meRole === 'manager';
  const isEditingAdmin = !!editing && editing.role === 'admin';

  const [form, setForm] = useState({
    email: editing?.email || '',
    full_name: editing?.full_name || '',
    role: (editing?.role || 'operator') as Role,
    is_active: editing?.is_active ?? true,
    password: '',
  });

  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  function validateCreate() {
    const email = String(form.email || '').trim().toLowerCase();
    const pw = String(form.password || '');
    if (!email) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email format is invalid.';
    if (!pw || pw.length < 8) return 'Password must be at least 8 characters.';
    if (isManager && form.role === 'admin') return 'Managers cannot create admin users.';
    return '';
  }

  function validateEdit() {
    if (isManager && isEditingAdmin) return 'Managers cannot modify admin users.';
    if (form.role === 'admin' && isManager) return 'Managers cannot promote users to admin.';
    if (form.password && form.password.length < 8) return 'Password must be at least 8 characters.';
    return '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setModalError('');
    setPageError('');
    setAccessDenied(false);

    const err = editing ? validateEdit() : validateCreate();
    if (err) {
      setModalError(err);
      return;
    }

    setSaving(true);

    if (!editing) {
      const payload = {
        email: String(form.email || '').trim().toLowerCase(),
        password: String(form.password || ''),
        full_name: String(form.full_name || '').trim(),
        role: form.role,
        is_active: !!form.is_active,
      };

      const resp = await apiClient.post('/api/users', payload);

      if ((resp as any)?.error) {
        const msg = String((resp as any).error || 'Failed to create user');
        setModalError(msg);
        if (isForbiddenError(msg)) setAccessDenied(true);
        setSaving(false);
        return;
      }

      await onSaved();
      onClose();
      setSaving(false);
      return;
    }

    // editing: send only changes
    const patch: any = {};
    if (String(form.full_name ?? '') !== String(editing.full_name ?? '')) patch.full_name = String(form.full_name || '').trim();
    if (form.role !== editing.role) patch.role = form.role;
    if (!!form.is_active !== !!editing.is_active) patch.is_active = !!form.is_active;
    if (form.password) patch.password = String(form.password);

    if (Object.keys(patch).length === 0) {
      setModalError('No changes to save.');
      setSaving(false);
      return;
    }

    const resp = await apiClient.put(`/api/users/${editing.id}`, patch);

    if ((resp as any)?.error) {
      const msg = String((resp as any).error || 'Failed to update user');
      setModalError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
      setSaving(false);
      return;
    }

    await onSaved();
    onClose();
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">{editing ? 'Edit User' : 'Add User'}</h2>

          {modalError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div>{modalError}</div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              value={form.email}
              disabled={!!editing}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
              required={!editing}
            />
            {editing && <p className="text-xs text-gray-500 mt-1">Email cannot be changed.</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
            <input
              type="text"
              value={String(form.full_name || '')}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={form.role}
                disabled={isManager && (isEditingAdmin || form.role === 'admin')}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-50"
              >
                <option value="operator">Operator</option>
                <option value="manager">Manager</option>
                <option value="admin" disabled={isManager}>
                  Admin
                </option>
              </select>
              {isManager && <p className="text-xs text-gray-500 mt-1">Managers cannot create/promote admin.</p>}
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!!form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Active
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {editing ? 'Reset password (optional)' : 'Password *'}
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={editing ? 'Leave empty to keep current password' : 'Min 8 chars'}
              required={!editing}
            />
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
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
