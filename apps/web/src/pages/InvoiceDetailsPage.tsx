import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileText, RefreshCcw, AlertTriangle, Download, ArrowLeft, CreditCard, X, Plus } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useBranch } from '../contexts/BranchContext';

type Role = 'operator' | 'admin' | 'manager';

type InvoiceDetailPayload = {
  invoice: any;
  items: Array<{
    id: string;
    description?: string;
    quantity?: number | string;
    unit_price?: number | string;
    amount?: number | string;
  }>;
};

type PaymentRow = {
  id: string;
  payment_number?: string;
  payment_date?: string;
  paid_at?: string | null;
  amount?: number | string;
  payment_method?: string;
  reference_number?: string;
  notes?: string;
  created_at?: string;
  created_by?: string;
};

function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function money(v: unknown) {
  const n = num(v, NaN as any);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function moneyUSD(v: unknown) {
  const m = money(v);
  return m === '—' ? '—' : `$${m}`;
}

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp?.error) return String(resp.error);
  if (resp?.success === false) return String(resp.error || resp.message || 'Request failed');
  if (resp?.data?.success === false) return String(resp.data.error || resp.data.message || 'Request failed');
  return null;
}

function withQuery(path: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && String(v).trim() !== '') qs.set(k, String(v));
  });
  const s = qs.toString();
  if (!s) return path;
  return path.includes('?') ? `${path}&${s}` : `${path}?${s}`;
}

function unwrapInvoiceDetail(resp: any): InvoiceDetailPayload | null {
  const root = resp?.data ?? resp;
  const payload =
    root?.data?.data ??
    root?.data ??
    root;

  // Expect shape: { invoice, items }
  if (payload && typeof payload === 'object' && ('invoice' in payload || 'items' in payload)) {
    return {
      invoice: (payload as any)?.invoice ?? null,
      items: Array.isArray((payload as any)?.items) ? (payload as any).items : [],
    };
  }

  return null;
}

function unwrapArray<T>(resp: any): T[] {
  const root = resp?.data ?? resp;
  const arr =
    Array.isArray(root) ? root :
    Array.isArray(root?.data) ? root.data :
    Array.isArray(root?.data?.data) ? root.data.data :
    Array.isArray(root?.rows) ? root.rows :
    Array.isArray(root?.data?.rows) ? root.data.rows :
    [];
  return Array.isArray(arr) ? (arr as T[]) : [];
}

function toLocalDatetimeInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function statusBadge(statusTxt: string) {
  const s = (statusTxt || '').toLowerCase();
  if (s === 'paid') return 'bg-green-50 text-green-700';
  if (s === 'overdue') return 'bg-red-50 text-red-700';
  if (s === 'cancelled') return 'bg-gray-100 text-gray-700';
  return 'bg-yellow-50 text-yellow-700';
}

function PaymentsDrawer(props: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  canCreate: boolean;
  adminBranchFilter?: string;
  onInvoiceUpdated?: (invoice: any) => void;
}) {
  const { open, onClose, invoiceId, canCreate, adminBranchFilter, onInvoiceUpdated } = props;
  const mountedRef = useRef(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  // form
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'other'>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [paidAt, setPaidAt] = useState(() => toLocalDatetimeInputValue(new Date()));
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    if (!invoiceId) return;

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const url = withQuery('/api/payments', {
        invoice_id: invoiceId,
        limit: '500',
        offset: '0',
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.get<any>(url);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) throw new Error(err);

      setPayments(unwrapArray<PaymentRow>(resp));
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Failed to load payments');
      setPayments([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [invoiceId, adminBranchFilter]);

  useEffect(() => {
    mountedRef.current = true;
    if (open) void load();
    return () => {
      mountedRef.current = false;
    };
  }, [open, load]);

  async function recordPayment() {
    if (!canCreate) return;
    setError('');
    setSuccessMsg('');

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Amount must be a positive number.');
      return;
    }

    const paidAtIso = (() => {
      const dt = new Date(paidAt);
      if (Number.isNaN(dt.getTime())) return new Date().toISOString();
      return dt.toISOString();
    })();

    setSaving(true);
    try {
      const url = withQuery('/api/payments', {
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.post<any>(url, {
        invoice_id: invoiceId,
        amount: amt,
        payment_method: method,
        reference_number: reference,
        notes,
        paid_at: paidAtIso,
      });

      const err = pickErrorMessage(resp);
      if (err) throw new Error(err);

      const payload = (resp as any)?.data?.data ?? (resp as any)?.data ?? null;
      const updatedInvoice = payload?.invoice ?? null;

      setSuccessMsg('Payment recorded successfully.');
      setAmount('');
      setReference('');
      setNotes('');
      setPaidAt(toLocalDatetimeInputValue(new Date()));

      if (updatedInvoice && onInvoiceUpdated) onInvoiceUpdated(updatedInvoice);

      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const totalPaid = payments.reduce((s, p) => s + num(p.amount, 0), 0);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl flex flex-col">
        <div className="p-5 border-b border-gray-200 flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-blue-600" />
              Payments
            </div>
            <div className="text-xs text-gray-500 mt-1">Invoice: {invoiceId}</div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-700" />
          </button>
        </div>

        <div className="p-5 overflow-auto flex-1">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div className="text-sm">{error}</div>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
              {successMsg}
            </div>
          )}

          {/* List */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">
                Payment History <span className="text-gray-500 font-normal">({payments.length})</span>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                className="text-sm inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
                disabled={loading}
              >
                <RefreshCcw className="w-4 h-4" />
                Refresh
              </button>
            </div>

            <div className="px-4 py-3 text-sm text-gray-600">
              Total recorded: <span className="font-semibold text-gray-900">{moneyUSD(totalPaid)}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Payment</th>
                    <th className="text-left font-medium px-4 py-3">Method</th>
                    <th className="text-left font-medium px-4 py-3">Date</th>
                    <th className="text-right font-medium px-4 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {!loading && payments.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-gray-500">
                        No payments found.
                      </td>
                    </tr>
                  )}

                  {(loading ? Array.from({ length: 5 }) : payments).map((p: any, idx: number) => {
                    const isSk = loading;
                    const id = String(p?.id || `sk-${idx}`);

                    return (
                      <tr key={id}>
                        <td className="px-4 py-3">
                          {isSk ? (
                            <div className="h-4 w-28 bg-gray-100 rounded" />
                          ) : (
                            <div className="font-medium text-gray-900">{p?.payment_number || '—'}</div>
                          )}
                          {!isSk && p?.reference_number ? <div className="text-xs text-gray-500">Ref: {p.reference_number}</div> : null}
                          {!isSk && p?.notes ? <div className="text-xs text-gray-500">Note: {p.notes}</div> : null}
                        </td>
                        <td className="px-4 py-3">
                          {isSk ? <div className="h-4 w-20 bg-gray-100 rounded" /> : <span className="text-gray-700">{p?.payment_method || '—'}</span>}
                        </td>
                        <td className="px-4 py-3">
                          {isSk ? (
                            <div className="h-4 w-24 bg-gray-100 rounded" />
                          ) : (
                            <span className="text-gray-700">
                              {p?.paid_at ? new Date(p.paid_at).toLocaleString() : p?.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isSk ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <span className="text-gray-900">{moneyUSD(p?.amount)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Record payment */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Record Payment
            </div>

            {!canCreate ? (
              <div className="text-sm text-gray-600">
                Only <span className="font-medium">admin/manager</span> can record payments.
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600 mb-1">Amount *</div>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="e.g. 5000"
                  />
                </div>

                <div>
                  <div className="text-sm text-gray-600 mb-1">Method *</div>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as any)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white"
                  >
                    <option value="cash">cash</option>
                    <option value="check">check</option>
                    <option value="bank_transfer">bank_transfer</option>
                    <option value="credit_card">credit_card</option>
                    <option value="other">other</option>
                  </select>
                </div>

                <div>
                  <div className="text-sm text-gray-600 mb-1">Paid At</div>
                  <input
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                    type="datetime-local"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>

                <div>
                  <div className="text-sm text-gray-600 mb-1">Reference (optional)</div>
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="Bank slip / cheque number…"
                  />
                </div>

                <div>
                  <div className="text-sm text-gray-600 mb-1">Notes (optional)</div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    rows={3}
                    placeholder="Additional notes…"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void recordPayment()}
                  disabled={saving}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <CreditCard className="w-4 h-4" />
                  {saving ? 'Saving…' : 'Record Payment'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const mountedRef = useRef(true);

  const { user, profile } = useAuth();
  const { branchId } = useBranch();

  const role = (user?.role || (profile as any)?.role || 'operator') as Role;
  const isAdmin = role === 'admin';
  const isAdminOrManager = role === 'admin' || role === 'manager';

  const invoiceId = String(id || '').trim();

  // Admin-only optional scope (when admin selects a branch in header)
  const adminBranchFilter = isAdmin && branchId ? String(branchId) : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [invoice, setInvoice] = useState<any | null>(null);
  const [items, setItems] = useState<InvoiceDetailPayload['items']>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!invoiceId) return;

    setLoading(true);
    setError('');

    try {
      const url = withQuery(`/api/invoices/${invoiceId}`, {
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.get<any>(url);
      if (!mountedRef.current) return;

      const err = pickErrorMessage(resp);
      if (err) throw new Error(err);

      const payload = unwrapInvoiceDetail(resp);
      setInvoice(payload?.invoice ?? null);
      setItems(Array.isArray(payload?.items) ? payload!.items : []);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Failed to load invoice');
      setInvoice(null);
      setItems([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [invoiceId, adminBranchFilter]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  async function downloadPdf() {
    if (!invoiceId) return;
    setError('');

    try {
      const url = withQuery(`/api/invoices/${invoiceId}/pdf`, {
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.getBlob(url);
      const err = pickErrorMessage(resp);
      if (err) {
        setError(err);
        return;
      }

      const blob = (resp as any)?.data;
      if (!(blob instanceof Blob)) {
        setError('PDF download failed: invalid response type.');
        return;
      }

      const invoiceNo = String(invoice?.invoice_number || invoiceId);
      const fileUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = fileUrl;
      a.download = `invoice-${invoiceNo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(fileUrl);
    } catch (e: any) {
      setError(e?.message || 'PDF download failed.');
    }
  }

  async function cancelInvoice() {
    if (!isAdminOrManager) return;
    if (!invoiceId) return;

    const statusTxt = String(invoice?.status || '').toLowerCase();
    if (statusTxt === 'paid') {
      setError('Cannot cancel a paid invoice.');
      return;
    }
    if (statusTxt === 'cancelled') return;

    const reasonInput = window.prompt('Cancel invoice reason (optional):', '');
    if (reasonInput === null) return;

    const reason = String(reasonInput || '').trim();
    setError('');

    try {
      const url = withQuery(`/api/invoices/${invoiceId}/cancel`, {
        ...(adminBranchFilter ? { branch_id: adminBranchFilter } : {}),
      });

      const resp = await apiClient.patch<any>(url, { reason });

      const err = pickErrorMessage(resp);
      if (err) {
        setError(err);
        return;
      }

      const updated = (resp as any)?.data?.data ?? (resp as any)?.data ?? null;
      if (updated?.id) setInvoice((prev: any) => ({ ...(prev || {}), ...updated }));
      else await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel invoice');
    }
  }

  // ✅ Fallback: compute subtotal/tax/total from items if invoice fields not present
  const computedTotals = useMemo(() => {
    const subtotalFromItems = items.reduce((s, it) => {
      const qty = Math.max(1, num(it?.quantity, 1));
      const unit = num(it?.unit_price, 0);
      const amt = it?.amount != null ? num(it.amount, qty * unit) : qty * unit;
      return s + amt;
    }, 0);

    const subtotal = Number.isFinite(num(invoice?.subtotal, NaN as any)) ? num(invoice?.subtotal, 0) : subtotalFromItems;

    // Prefer backend tax_amount; otherwise GST 5%
    const tax =
      Number.isFinite(num(invoice?.tax_amount, NaN as any)) ? num(invoice?.tax_amount, 0) : subtotal * 0.05;

    const total =
      Number.isFinite(num(invoice?.total_amount, NaN as any)) ? num(invoice?.total_amount, 0) : subtotal + tax;

    const paid = num(invoice?.paid_amount, 0);

    const bal =
      Number.isFinite(num(invoice?.balance, NaN as any))
        ? Math.max(0, num(invoice?.balance, 0))
        : Math.max(0, total - paid);

    return { subtotal, tax, total, paid, bal };
  }, [invoice, items]);

  const customerName = useMemo(() => {
    if (!invoice) return '—';
    return (
      String(invoice?.company_name || '').trim() ||
      (String(invoice?.walk_in_name || '').trim() ? `WALK-IN: ${String(invoice.walk_in_name).trim()}` : 'WALK-IN')
    );
  }, [invoice]);

  const statusTxt = String(invoice?.status || '').toLowerCase();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/invoices')} className="p-2 rounded-lg hover:bg-gray-100" title="Back">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <FileText className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Invoice Details</h1>
            <div className="text-sm text-gray-500">{invoice?.invoice_number || invoiceId}</div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
            disabled={loading}
          >
            <RefreshCcw className="w-4 h-4" />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => void downloadPdf()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
            disabled={loading}
          >
            <Download className="w-4 h-4" />
            PDF
          </button>

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            disabled={loading}
          >
            <CreditCard className="w-4 h-4" />
            Payments
          </button>

          {isAdminOrManager && statusTxt !== 'cancelled' && (
            <button
              type="button"
              onClick={() => void cancelInvoice()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
              disabled={loading}
              title="Cancel invoice (admin/manager)"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {/* Header cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Customer</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{loading ? '—' : customerName}</div>
          <div className="mt-2 text-sm text-gray-600">
            Branch: <span className="font-medium text-gray-900">{invoice?.branch_name || '—'}</span>
          </div>
          <div className="mt-1 text-sm text-gray-600">
            Status:{' '}
            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${statusBadge(statusTxt)}`}>
              {statusTxt || 'unknown'}
            </span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Truck / Weighing</div>
          <div className="mt-2 text-sm text-gray-700">
            Assigned Truck ID: <span className="font-medium text-gray-900">{invoice?.assigned_truck_id ?? '—'}</span>
          </div>
          <div className="mt-1 text-sm text-gray-700">
            Side: <span className="font-medium text-gray-900">{invoice?.truck_side_number || '—'}</span>
          </div>
          <div className="mt-1 text-sm text-gray-700">
            TXN: <span className="font-medium text-gray-900">{invoice?.transaction_number || '—'}</span>
          </div>
          <div className="mt-1 text-sm text-gray-700">
            Net weight:{' '}
            <span className="font-semibold text-gray-900">{invoice?.net_weight != null ? `${money(invoice.net_weight)} kg` : '—'}</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Totals</div>
          <div className="mt-2 text-sm text-gray-700">
            Subtotal: <span className="font-medium text-gray-900">{moneyUSD(computedTotals.subtotal)}</span>
          </div>
          <div className="mt-1 text-sm text-gray-700">
            Tax (5%): <span className="font-medium text-gray-900">{moneyUSD(computedTotals.tax)}</span>
          </div>
          <div className="mt-1 text-sm text-gray-700">
            Total: <span className="font-semibold text-gray-900">{moneyUSD(computedTotals.total)}</span>
          </div>
          <div className="mt-1 text-sm text-gray-700">
            Paid: <span className="font-medium text-gray-900">{moneyUSD(computedTotals.paid)}</span>
          </div>
          <div className="mt-1 text-sm text-gray-700">
            Balance: <span className="font-semibold text-gray-900">{moneyUSD(computedTotals.bal)}</span>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">Charges</div>
          <div className="text-sm text-gray-500">{items.length} item(s)</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Description</th>
                <th className="text-right font-medium px-6 py-3">Qty</th>
                <th className="text-right font-medium px-6 py-3">Unit</th>
                <th className="text-right font-medium px-6 py-3">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-gray-500">
                    No line items found.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 3 }) : items).map((it: any, idx: number) => {
                const isSk = loading;
                const key = String(it?.id || `sk-${idx}`);
                const qty = Math.max(1, num(it?.quantity, 1));
                const unit = num(it?.unit_price, 0);
                const amt = it?.amount != null ? num(it.amount, qty * unit) : qty * unit;

                return (
                  <tr key={key}>
                    <td className="px-6 py-4">
                      {isSk ? <div className="h-4 w-80 bg-gray-100 rounded" /> : <div className="text-gray-900">{String(it?.description || '—')}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isSk ? <div className="h-4 w-10 bg-gray-100 rounded ml-auto" /> : <div className="text-gray-700">{qty.toFixed(0)}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isSk ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <div className="text-gray-700">{moneyUSD(unit)}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isSk ? <div className="h-4 w-16 bg-gray-100 rounded ml-auto" /> : <div className="text-gray-900">{moneyUSD(amt)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Notes */}
      {!loading && invoice?.notes ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm text-gray-500">Notes</div>
          <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{String(invoice.notes)}</div>
        </div>
      ) : null}

      <PaymentsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        invoiceId={invoiceId}
        canCreate={isAdminOrManager}
        adminBranchFilter={adminBranchFilter}
        onInvoiceUpdated={(inv) => setInvoice((prev: any) => ({ ...(prev || {}), ...(inv || {}) }))}
      />
    </div>
  );
}
