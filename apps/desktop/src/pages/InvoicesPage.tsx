import { useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCcw, AlertTriangle, Download, Search, CreditCard, X, Loader2, Ban } from 'lucide-react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';

type InvoiceRow = {
  id: string;
  invoice_number?: string;
  invoice_date?: string;
  status?: string;
  total_amount?: number | string;
  paid_amount?: number | string;
  balance?: number | string;
  company_name?: string;
};

type PaymentRow = {
  id: string;
  payment_number?: string;
  payment_date?: string; // YYYY-MM-DD
  paid_at?: string; // ISO datetime
  amount?: number | string;
  payment_method?: string;
  reference_number?: string;
  notes?: string;
  created_at?: string;
};

function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}
function money(v: unknown) {
  return num(v, 0).toFixed(2);
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

function unwrapObject<T>(resp: any): T | null {
  const root = resp?.data ?? resp;
  if (!root) return null;
  if (root?.data && typeof root.data === 'object' && !Array.isArray(root.data)) return root.data as T;
  if (typeof root === 'object' && !Array.isArray(root)) return root as T;
  return null;
}

async function safeGetArray<T = any>(endpoint: string): Promise<T[]> {
  const resp = await apiClient.get<any>(endpoint);
  const err = pickErrorMessage(resp);
  if (err) throw new Error(err);
  return unwrapArray<T>(resp);
}

async function safeGetObject<T = any>(endpoint: string): Promise<T> {
  const resp = await apiClient.get<any>(endpoint);
  const err = pickErrorMessage(resp);
  if (err) throw new Error(err);
  const obj = unwrapObject<T>(resp);
  if (!obj) throw new Error('Invalid response');
  return obj;
}

function getHeaderContentType(headers: any): string {
  if (!headers) return '';
  const ax = headers['content-type'] || headers['Content-Type'];
  if (typeof ax === 'string') return ax;
  if (typeof headers.get === 'function') {
    const v = headers.get('content-type');
    if (typeof v === 'string') return v;
  }
  return '';
}

async function blobToText(blob: Blob): Promise<string> {
  try {
    return await blob.text();
  } catch {
    return '';
  }
}

function isLikelyJsonOrText(contentType: string, blob: Blob): boolean {
  const ct = (contentType || blob.type || '').toLowerCase();
  if (ct.includes('application/json')) return true;
  if (ct.startsWith('text/')) return true;
  if (ct.includes('application/problem+json')) return true;
  return false;
}

function fmtDateTime(v?: string) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/**
 * Best-effort role detection (UI-only convenience).
 * Backend still enforces permissions, so even if this fails, it remains secure.
 */
function getUserRole(): string {
  const keys = ['role', 'user', 'auth_user', 'currentUser', 'weighbridge_user'];
  for (const k of keys) {
    try {
      const v = window.localStorage.getItem(k);
      if (!v) continue;
      if (k === 'role') return String(v || '').toLowerCase();
      const obj = JSON.parse(v);
      const role = obj?.role || obj?.user?.role || obj?.data?.role;
      if (role) return String(role).toLowerCase();
    } catch {}
  }
  return '';
}

const ALLOWED_METHODS = [
  { value: 'cash', label: 'cash' },
  { value: 'check', label: 'check' },
  { value: 'bank_transfer', label: 'bank_transfer' },
  { value: 'credit_card', label: 'credit_card' },
  { value: 'other', label: 'other' },
];

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<any | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);

  // Payment form
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [refNo, setRefNo] = useState('');
  const [paidAt, setPaidAt] = useState(toDatetimeLocalValue(new Date()));
  const [notes, setNotes] = useState('');

  const role = getUserRole();
  const canFinance = role === 'admin' || role === 'manager' || role === ''; // if unknown, let backend decide

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((inv) => {
      const hay = [inv.invoice_number, inv.company_name, inv.status].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  async function loadInvoices() {
    setError('');
    setLoading(true);
    try {
      const data = await safeGetArray<InvoiceRow>('/api/invoices?limit=50');
      setRows(data);
    } catch (e: unknown) {
      setRows([]);
      setError(e instanceof Error ? e.message : 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInvoices();
  }, []);

  async function downloadInvoicePdf(invoiceId: string, invoiceNumber?: string) {
    try {
      setError('');

      const resp = await apiClient.getBlob(`/api/invoices/${invoiceId}/pdf`);

      const blob: Blob | null =
        resp instanceof Blob ? resp :
        resp?.data instanceof Blob ? resp.data :
        null;

      if (!blob) {
        const err = pickErrorMessage(resp);
        setError(err || 'PDF download failed: invalid response');
        return;
      }

      const contentType = getHeaderContentType((resp as any)?.headers) || blob.type || '';

      if (isLikelyJsonOrText(contentType, blob)) {
        const txt = await blobToText(blob);
        try {
          const j = JSON.parse(txt);
          const msg =
            (typeof j?.error === 'string' && j.error) ||
            (typeof j?.message === 'string' && j.message) ||
            'Failed to download invoice PDF';
          setError(msg);
          return;
        } catch {
          setError(txt || 'Failed to download invoice PDF');
          return;
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${invoiceNumber || invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to download invoice PDF');
    }
  }

  function resetPaymentForm() {
    setAmount('');
    setMethod('cash');
    setRefNo('');
    setPaidAt(toDatetimeLocalValue(new Date()));
    setNotes('');
  }

  async function openPaymentsDrawer(inv: InvoiceRow) {
    setSelected(inv);
    setDrawerOpen(true);
    setPayError('');
    setPayLoading(true);
    resetPaymentForm();

    try {
      // Fetch invoice detail (latest totals/balance/status) + payments list
      const detailResp = await safeGetObject<{ invoice: any; items: any[] }>(`/api/invoices/${inv.id}`);
      setInvoiceDetail(detailResp);

      const pays = await safeGetArray<PaymentRow>(`/api/payments?invoice_id=${encodeURIComponent(inv.id)}&limit=200`);
      setPayments(pays);
    } catch (e: any) {
      setInvoiceDetail(null);
      setPayments([]);
      setPayError(e instanceof Error ? e.message : 'Failed to load payments');
    } finally {
      setPayLoading(false);
    }
  }

  async function refreshDrawerData() {
    if (!selected) return;
    setPayError('');
    setPayLoading(true);
    try {
      const detailResp = await safeGetObject<{ invoice: any; items: any[] }>(`/api/invoices/${selected.id}`);
      setInvoiceDetail(detailResp);

      const pays = await safeGetArray<PaymentRow>(`/api/payments?invoice_id=${encodeURIComponent(selected.id)}&limit=200`);
      setPayments(pays);

      // also refresh invoices list so table reflects new balances/status
      void loadInvoices();
    } catch (e: any) {
      setPayError(e instanceof Error ? e.message : 'Failed to refresh');
    } finally {
      setPayLoading(false);
    }
  }

  const invSummary = useMemo(() => {
    const inv = invoiceDetail?.invoice || selected;
    if (!inv) return null;

    const status = String(inv?.status || '').toLowerCase();
    const total = num(inv?.total_amount, 0);
    const paid = num(inv?.paid_amount, 0);
    const bal = num(inv?.balance, Math.max(0, total - paid));

    const canCancel = bal > 0 && paid <= 0.00001 && status !== 'cancelled';
    const isCancelled = status === 'cancelled';

    return {
      id: String(inv?.id || selected?.id || ''),
      invoice_number: String(inv?.invoice_number || selected?.invoice_number || ''),
      invoice_date: String(inv?.invoice_date || selected?.invoice_date || ''),
      company_name: String(inv?.company_name || selected?.company_name || '—'),
      status,
      total,
      paid,
      bal,
      canCancel,
      isCancelled,
    };
  }, [invoiceDetail, selected]);

  async function submitPayment() {
    if (!selected) return;
    setPayError('');
    setSubmitBusy(true);

    try {
      const amt = parseFloat(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setPayError('Amount must be a positive number');
        setSubmitBusy(false);
        return;
      }

      // Convert datetime-local to ISO
      const paidAtIso = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();
      if (Number.isNaN(new Date(paidAtIso).getTime())) {
        setPayError('Paid at must be a valid datetime');
        setSubmitBusy(false);
        return;
      }

      const resp = await apiClient.post<any>('/api/payments', {
        invoice_id: selected.id,
        amount: amt,
        payment_method: method,
        reference_number: refNo || undefined,
        paid_at: paidAtIso,
        notes: notes || undefined,
      });

      const err = pickErrorMessage(resp);
      if (err) throw new Error(err);

      // refresh
      await refreshDrawerData();
      resetPaymentForm();
    } catch (e: any) {
      setPayError(e instanceof Error ? e.message : 'Failed to record payment');
    } finally {
      setSubmitBusy(false);
    }
  }

  async function cancelInvoice() {
    if (!selected) return;
    setPayError('');
    setSubmitBusy(true);

    try {
      // If you implemented PATCH /api/invoices/:id/cancel in backend:
      const resp = await apiClient.patch<any>(`/api/invoices/${selected.id}/cancel`, {});
      const err = pickErrorMessage(resp);
      if (err) throw new Error(err);

      await refreshDrawerData();
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'Failed to cancel invoice';

      // Friendly hint if endpoint not implemented yet
      const low = String(msg).toLowerCase();
      if (low.includes('404') || low.includes('not found') || low.includes('cannot patch')) {
        setPayError('Cancel endpoint is not available yet (expected PATCH /api/invoices/:id/cancel).');
      } else {
        setPayError(msg);
      }
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Receipts</h1>
        </div>

        <button
          type="button"
          onClick={() => void loadInvoices()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
          disabled={loading}
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
        <div className="relative">
          <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by invoice #, client, status..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="text-lg font-semibold text-gray-900">Recent invoices</div>
          <div className="text-sm text-gray-500">{loading ? 'Loading...' : `${filtered.length} result(s)`}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-6 py-3">Invoice</th>
                <th className="text-left font-medium px-6 py-3">Client</th>
                <th className="text-left font-medium px-6 py-3">Status</th>
                <th className="text-right font-medium px-6 py-3">Total</th>
                <th className="text-right font-medium px-6 py-3">Paid</th>
                <th className="text-right font-medium px-6 py-3">Balance</th>
                <th className="text-right font-medium px-6 py-3">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-gray-500" colSpan={7}>
                    No invoices found.
                  </td>
                </tr>
              )}

              {(loading ? Array.from({ length: 8 }) : filtered).map((inv: any, idx: number) => {
                const isSk = loading;
                const id = String(inv?.id || `sk-${idx}`);
                const invoiceNumber = String(inv?.invoice_number || '');
                const client = String(inv?.company_name || '—');
                const status = String(inv?.status || '').toLowerCase();

                return (
                  <tr key={id}>
                    <td className="px-6 py-4">
                      {isSk ? (
                        <div className="h-4 w-28 bg-gray-100 rounded" />
                      ) : (
                        <div className="font-medium text-gray-900">{invoiceNumber || id}</div>
                      )}
                      {!isSk && inv?.invoice_date ? (
                        <div className="text-xs text-gray-500">{String(inv.invoice_date)}</div>
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
                        <div className="h-4 w-20 bg-gray-100 rounded" />
                      ) : (
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            status === 'paid'
                              ? 'bg-green-50 text-green-700'
                              : status === 'overdue'
                              ? 'bg-red-50 text-red-700'
                              : status === 'cancelled'
                              ? 'bg-gray-100 text-gray-700'
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
                        <span className="text-gray-900">${money(inv?.total_amount)}</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? (
                        <div className="h-4 w-16 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <span className="text-gray-900">${money(inv?.paid_amount)}</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? (
                        <div className="h-4 w-16 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <span className="text-gray-900">${money(inv?.balance)}</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isSk ? (
                        <div className="h-8 w-36 bg-gray-100 rounded ml-auto" />
                      ) : (
                        <div className="inline-flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => void downloadInvoicePdf(id, invoiceNumber)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
                          >
                            <Download className="w-4 h-4" />
                            Receipt
                          </button>

                          <button
                            type="button"
                            onClick={() => void openPaymentsDrawer(inv)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                          >
                            <CreditCard className="w-4 h-4" />
                            Payments
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------- Payments Drawer ---------------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              setDrawerOpen(false);
              setSelected(null);
              setInvoiceDetail(null);
              setPayments([]);
              setPayError('');
            }}
          />

          {/* Panel */}
          <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-gray-900">Payments</div>
                <div className="text-sm text-gray-500">
                  {invSummary?.invoice_number ? invSummary.invoice_number : selected?.id || '—'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  setSelected(null);
                  setInvoiceDetail(null);
                  setPayments([]);
                  setPayError('');
                }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              {payError && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 mt-0.5" />
                  <div className="text-sm">{payError}</div>
                </div>
              )}

              {/* Summary */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-gray-900">Invoice summary</div>
                  <button
                    type="button"
                    onClick={() => void refreshDrawerData()}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
                    disabled={payLoading}
                  >
                    {payLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                    Refresh
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Client</div>
                    <div className="text-gray-900 font-medium">{invSummary?.company_name || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Status</div>
                    <div className="text-gray-900 font-medium">{invSummary?.status || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Total</div>
                    <div className="text-gray-900 font-medium">${money(invSummary?.total)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Paid</div>
                    <div className="text-gray-900 font-medium">${money(invSummary?.paid)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Balance</div>
                    <div className="text-gray-900 font-medium">${money(invSummary?.bal)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Invoice date</div>
                    <div className="text-gray-900 font-medium">{invSummary?.invoice_date || '—'}</div>
                  </div>
                </div>

                {/* Cancel invoice */}
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void cancelInvoice()}
                    disabled={!canFinance || submitBusy || !invSummary?.canCancel}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
                    title={
                      !canFinance
                        ? 'Only admin/manager can cancel invoices'
                        : invSummary?.isCancelled
                        ? 'Invoice is already cancelled'
                        : invSummary?.canCancel
                        ? 'Cancel invoice (only allowed if paid_amount = 0)'
                        : 'Cancel requires paid_amount = 0 and balance > 0'
                    }
                  >
                    <Ban className="w-4 h-4" />
                    Cancel invoice
                  </button>
                </div>
              </div>

              {/* Payments table */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Payment history</div>
                    <div className="text-xs text-gray-500">
                      {payLoading ? 'Loading...' : `${payments.length} payment(s)`}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">Paid at</th>
                        <th className="text-left font-medium px-4 py-3">Method</th>
                        <th className="text-left font-medium px-4 py-3">Reference</th>
                        <th className="text-right font-medium px-4 py-3">Amount</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-200">
                      {payLoading ? (
                        Array.from({ length: 4 }).map((_, i) => (
                          <tr key={`sk-${i}`}>
                            <td className="px-4 py-3"><div className="h-4 w-32 bg-gray-100 rounded" /></td>
                            <td className="px-4 py-3"><div className="h-4 w-20 bg-gray-100 rounded" /></td>
                            <td className="px-4 py-3"><div className="h-4 w-28 bg-gray-100 rounded" /></td>
                            <td className="px-4 py-3 text-right"><div className="h-4 w-16 bg-gray-100 rounded ml-auto" /></td>
                          </tr>
                        ))
                      ) : payments.length === 0 ? (
                        <tr>
                          <td className="px-4 py-5 text-gray-500" colSpan={4}>
                            No payments recorded for this invoice.
                          </td>
                        </tr>
                      ) : (
                        payments.map((p) => (
                          <tr key={String(p.id)}>
                            <td className="px-4 py-3 text-gray-700">{fmtDateTime(p.paid_at || p.created_at)}</td>
                            <td className="px-4 py-3 text-gray-700">{String(p.payment_method || '—')}</td>
                            <td className="px-4 py-3 text-gray-700">{String(p.reference_number || '—')}</td>
                            <td className="px-4 py-3 text-right text-gray-900">${money(p.amount)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Record payment form */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Record a payment</div>
                    <div className="text-xs text-gray-500">Admin/Manager only (backend enforced)</div>
                  </div>
                </div>

                {!canFinance ? (
                  <div className="mt-3 text-sm text-gray-600">
                    Your role is not detected as admin/manager. If you actually are, you can still try — the backend will allow it.
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="e.g. 1000"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      inputMode="decimal"
                      disabled={submitBusy || invSummary?.isCancelled || (invSummary?.bal ?? 0) <= 0}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                      disabled={submitBusy || invSummary?.isCancelled || (invSummary?.bal ?? 0) <= 0}
                    >
                      {ALLOWED_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Paid at</label>
                    <input
                      type="datetime-local"
                      value={paidAt}
                      onChange={(e) => setPaidAt(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      disabled={submitBusy || invSummary?.isCancelled || (invSummary?.bal ?? 0) <= 0}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Reference (optional)</label>
                    <input
                      value={refNo}
                      onChange={(e) => setRefNo(e.target.value)}
                      placeholder="Bank ref / receipt #"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      disabled={submitBusy || invSummary?.isCancelled || (invSummary?.bal ?? 0) <= 0}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      disabled={submitBusy || invSummary?.isCancelled || (invSummary?.bal ?? 0) <= 0}
                    />
                  </div>
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetPaymentForm}
                    className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
                    disabled={submitBusy}
                  >
                    Clear
                  </button>

                  <button
                    type="button"
                    onClick={() => void submitPayment()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    disabled={
                      submitBusy ||
                      invSummary?.isCancelled ||
                      (invSummary?.bal ?? 0) <= 0
                    }
                    title={
                      invSummary?.isCancelled
                        ? 'Cannot record payments for a cancelled invoice'
                        : (invSummary?.bal ?? 0) <= 0
                        ? 'Invoice is fully paid'
                        : 'Record payment'
                    }
                  >
                    {submitBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                    Record payment
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-200 text-xs text-gray-500">
              Tip: if “Cancel invoice” shows “endpoint not available”, implement <code>PATCH /api/invoices/:id/cancel</code> in backend.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
