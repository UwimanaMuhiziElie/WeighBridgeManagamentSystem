import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { Branch } from '@weighbridge/shared';
import {
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  AlertTriangle,
  RotateCw,
  Power,
} from 'lucide-react';

type ApiKeyRow = {
  id: string;
  branch_id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  rate_limit: number;
  ip_whitelist: string[] | null;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  rotated_at?: string | null;
};

type AuditLogRow = {
  id: string;
  api_key_id: string;
  endpoint: string;
  method: string;
  status_code: number;
  ip_address: string | null;
  duration_ms: number | null;
  created_at: string;
};

function isForbiddenError(msg: string) {
  const m = (msg || '').toLowerCase();
  return m.includes('forbidden') || m.includes('403') || m.includes('request failed (403)');
}

function normalizeCommaList(s: string) {
  return String(s || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

export default function APIManagementPage() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';

  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  const [newKeyName, setNewKeyName] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(['*']);
  const [rateLimit, setRateLimit] = useState(60);
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);

  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);

  const mountedRef = useRef(true);

  const availablePermissions = useMemo(
    () => [
      { value: '*', label: 'All Permissions' },
      { value: 'transactions:read', label: 'Read Transactions' },
      { value: 'transactions:write', label: 'Create Transactions' },
      { value: 'clients:read', label: 'Read Clients' },
      { value: 'clients:write', label: 'Create Clients' },
      { value: 'invoices:read', label: 'Read Invoices' },
      { value: 'attendance:read', label: 'Read Attendance' },
      { value: 'attendance:write', label: 'Record Attendance' },
      { value: 'webhooks:write', label: 'Receive Webhooks' }, // if your middleware uses this
    ],
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadData(true);
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData(loadLogsIfEnabled: boolean) {
    if (!isAdminOrManager) return;

    setLoading(true);
    setPageError('');
    setAccessDenied(false);

    const [keysResp, branchesResp] = await Promise.all([
      apiClient.get<ApiKeyRow[]>('/api/api-keys'),
      apiClient.get<Branch[]>('/api/branches'),
    ]);

    if (!mountedRef.current) return;

    // Keys
    if ((keysResp as any)?.error) {
      const msg = String((keysResp as any).error || 'Failed to load API keys');
      setApiKeys([]);
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
    } else {
      setApiKeys(Array.isArray(keysResp.data) ? keysResp.data : []);
    }

    // Branches
    if ((branchesResp as any)?.error) {
      const msg = String((branchesResp as any).error || 'Failed to load branches');
      setBranches([]);
      // don’t overwrite a more important API-keys error
      if (!pageError) setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
    } else {
      setBranches(Array.isArray(branchesResp.data) ? branchesResp.data : []);
    }

    // Logs (optional)
    if (loadLogsIfEnabled && showAuditLogs) {
      const logsResp = await apiClient.get<AuditLogRow[]>('/api/api-keys/audit?limit=200');
      if (!mountedRef.current) return;

      if ((logsResp as any)?.error) {
        const msg = String((logsResp as any).error || 'Failed to load audit logs');
        setAuditLogs([]);
        // keep it as a non-fatal message
        if (!pageError) setPageError(msg);
      } else {
        setAuditLogs(Array.isArray(logsResp.data) ? logsResp.data : []);
      }
    }

    setLoading(false);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  function resetForm() {
    setNewKeyName('');
    setSelectedBranch('');
    setSelectedPermissions(['*']);
    setRateLimit(60);
    setIpWhitelist('');
    setExpiresInDays(null);
  }

  function togglePermission(perm: string, checked: boolean) {
    setSelectedPermissions((prev) => {
      const cur = new Set(prev);

      if (perm === '*') {
        // "All" overrides everything
        return checked ? ['*'] : [];
      }

      if (checked) {
        cur.add(perm);
        cur.delete('*'); // specific perms remove wildcard
      } else {
        cur.delete(perm);
      }

      const out = Array.from(cur);
      return out.length ? out : ['*']; // keep at least one selection
    });
  }

  async function createApiKey() {
    setPageError('');
    setAccessDenied(false);

    const name = newKeyName.trim();
    const branch_id = selectedBranch.trim();
    const permissions = selectedPermissions.length ? selectedPermissions : ['*'];

    if (!name || name.length < 2) {
      setPageError('Key name is required (min 2 chars).');
      return;
    }
    if (!branch_id) {
      setPageError('Please select a branch.');
      return;
    }
    if (!Number.isFinite(rateLimit) || rateLimit < 1 || rateLimit > 10000) {
      setPageError('Rate limit must be between 1 and 10000 requests/min.');
      return;
    }
    if (expiresInDays !== null && (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650)) {
      setPageError('Expiry days must be between 1 and 3650, or empty for no expiry.');
      return;
    }

    const ip_list = normalizeCommaList(ipWhitelist);
    // optional: basic sanity check
    if (ip_list.length > 50) {
      setPageError('IP whitelist too long (max 50 entries).');
      return;
    }

    setLoading(true);

    const resp = await apiClient.post<{ api_key: ApiKeyRow; raw_key: string }>(
      '/api/api-keys',
      {
        name,
        branch_id,
        permissions,
        rate_limit: rateLimit,
        ip_whitelist: ip_list.length ? ip_list : null,
        expires_in_days: expiresInDays,
      }
    );

    if ((resp as any)?.error) {
      const msg = String((resp as any).error || 'Failed to create API key');
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
      setLoading(false);
      return;
    }

    const raw = (resp as any)?.data?.raw_key;
    if (typeof raw === 'string' && raw.length > 20) {
      setGeneratedKey(raw);
    } else {
      // if backend didn’t return raw_key, that’s a bug (you can’t recover it)
      setPageError('Key created, but raw key was not returned. Check backend response.');
    }

    setShowCreateModal(false);
    resetForm();
    await loadData(false);
    setLoading(false);
  }

  async function rotateApiKey(id: string) {
    setPageError('');
    setAccessDenied(false);

    if (!confirm('Rotate this key? The old key will stop working immediately.')) return;

    setLoading(true);

    const resp = await apiClient.post<{ api_key: ApiKeyRow; raw_key: string }>(
      `/api/api-keys/${id}/rotate`,
      {}
    );

    if ((resp as any)?.error) {
      const msg = String((resp as any).error || 'Failed to rotate API key');
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
      setLoading(false);
      return;
    }

    const raw = (resp as any)?.data?.raw_key;
    if (typeof raw === 'string' && raw.length > 20) setGeneratedKey(raw);

    await loadData(false);
    setLoading(false);
  }

  async function toggleApiKeyStatus(id: string, currentActive: boolean) {
    setPageError('');
    setAccessDenied(false);

    setLoading(true);

    const resp = await apiClient.patch(`/api/api-keys/${id}/status`, {
      is_active: !currentActive,
    });

    if ((resp as any)?.error) {
      const msg = String((resp as any).error || 'Failed to update API key status');
      setPageError(msg);
      if (isForbiddenError(msg)) setAccessDenied(true);
      setLoading(false);
      return;
    }

    await loadData(false);
    setLoading(false);
  }

  // UI-level guard 
  if (!isAdminOrManager) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 mt-0.5" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Access Restricted</h1>
              <p className="text-gray-600 mt-1">
                Only <span className="font-medium">admin</span> and <span className="font-medium">manager</span> accounts can manage API keys.
              </p>
              <p className="text-gray-500 mt-2 text-sm">
                If you believe this is wrong, ask an admin to adjust your role.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">API Management</h1>
          <p className="text-gray-600 mt-1">Manage API keys and monitor usage</p>

          {pageError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div>{pageError}</div>
            </div>
          )}

          {accessDenied && (
            <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
              Your account does not have permission to manage API keys.
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setShowAuditLogs(v => !v);
              // load logs next render
              setTimeout(() => void loadData(true), 0);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            {showAuditLogs ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showAuditLogs ? 'Hide Logs' : 'View Logs'}
          </button>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Generate API Key
          </button>
        </div>
      </div>

      {generatedKey && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-900 mb-2">API Key Generated Successfully!</h3>
          <p className="text-sm text-green-700 mb-3">
            Copy this key now. You will not be able to view it again.
          </p>
          <div className="flex items-center gap-2 bg-white p-3 rounded border border-green-300">
            <code className="flex-1 text-sm font-mono break-all">{generatedKey}</code>
            <button
              type="button"
              onClick={() => copyToClipboard(generatedKey)}
              className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
            >
              {copiedKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedKey ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setGeneratedKey(null)}
            className="mt-3 text-sm text-green-700 hover:text-green-900"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
          <button
            type="button"
            onClick={() => void loadData(false)}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
            disabled={loading}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key Prefix</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Permissions</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate Limit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Used</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {apiKeys.map((k) => {
                const branchName = branches.find(b => b.id === k.branch_id)?.name || k.branch_id;

                return (
                  <tr key={k.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">{k.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{branchName}</td>
                    <td className="px-4 py-3 text-sm">
                      <code className="bg-gray-100 px-2 py-1 rounded">{k.key_prefix}…</code>
                    </td>

                    <td className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap gap-1">
                        {(k.permissions || []).slice(0, 2).map((perm, idx) => (
                          <span key={idx} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                            {perm}
                          </span>
                        ))}
                        {(k.permissions || []).length > 2 && (
                          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                            +{(k.permissions || []).length - 2} more
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-sm text-gray-600">{k.rate_limit}/min</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}
                    </td>

                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${
                          k.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {k.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void rotateApiKey(k.id)}
                          className="inline-flex items-center gap-1 text-gray-700 hover:text-gray-900"
                          title="Rotate key"
                          disabled={loading}
                        >
                          <RotateCw className="w-4 h-4" />
                          Rotate
                        </button>

                        <button
                          type="button"
                          onClick={() => void toggleApiKeyStatus(k.id, k.is_active)}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                          title={k.is_active ? 'Disable key' : 'Enable key'}
                          disabled={loading}
                        >
                          <Power className="w-4 h-4" />
                          {k.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && apiKeys.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-600">
                    No API keys found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAuditLogs && (
        <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">API Audit Logs</h2>
            <button
              type="button"
              onClick={() => void loadData(true)}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
              disabled={loading}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Endpoint</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">{log.endpoint}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                        {log.method}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          log.status_code < 300
                            ? 'bg-green-100 text-green-700'
                            : log.status_code < 400
                            ? 'bg-blue-100 text-blue-700'
                            : log.status_code < 500
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {log.status_code}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{log.ip_address || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{log.duration_ms ?? '-'}{log.duration_ms != null ? 'ms' : ''}</td>
                  </tr>
                ))}

                {!loading && auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-600">
                      No audit logs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Generate New API Key</h2>
              <p className="text-sm text-gray-600 mt-1">
                The raw key will be shown once after creation.
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key Name *</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Production API Key"
                  maxLength={120}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Branch *</label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Permissions *</label>
                <div className="space-y-2">
                  {availablePermissions.map((perm) => (
                    <label key={perm.value} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedPermissions.includes(perm.value)}
                        onChange={(e) => togglePermission(perm.value, e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{perm.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rate Limit (requests per minute)
                </label>
                <input
                  type="number"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  min={1}
                  max={10000}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  IP Whitelist (optional, comma-separated)
                </label>
                <input
                  type="text"
                  value={ipWhitelist}
                  onChange={(e) => setIpWhitelist(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="203.0.113.10, 198.51.100.24"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expires in (days, empty = no expiry)
                </label>
                <input
                  type="number"
                  value={expiresInDays ?? ''}
                  onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="90"
                  min={1}
                  max={3650}
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  resetForm();
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createApiKey()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Creating…' : 'Generate Key'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
