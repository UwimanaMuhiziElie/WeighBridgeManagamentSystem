import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { apiClient } from '@weighbridge/shared';

export type ClientOption = {
  id: string;
  company_name?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  status?: string;
};

async function safeGetArray<T = any>(endpoint: string): Promise<T[]> {
  const resp = await apiClient.get<any>(endpoint);
  if ((resp as any)?.error) throw new Error((resp as any).error);

  const data = (resp as any)?.data ?? resp;
  const arr =
    Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.rows) ? data.rows :
    Array.isArray(data?.data?.rows) ? data.data.rows :
    [];

  return Array.isArray(arr) ? (arr as T[]) : [];
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

type Props = {
  value: string; // client_id
  onChange: (clientId: string) => void;
  disabled?: boolean;
};

function label(c: ClientOption) {
  const name = c.company_name || 'Unnamed';
  const extra = c.contact_name ? ` • ${c.contact_name}` : '';
  return `${name}${extra}`;
}

function normalize(s: unknown) {
  return String(s ?? '').toLowerCase().trim();
}

function matchesClient(c: ClientOption, q: string) {
  const hay = [
    c.company_name,
    c.contact_name,
    c.phone,
    c.email,
    c.status,
    c.id,
  ].filter(Boolean).map(normalize).join(' ');
  return hay.includes(q);
}

export default function ClientSearchSelect({ value, onChange, disabled }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [selectedCache, setSelectedCache] = useState<ClientOption | null>(null);

  const debouncedQ = useDebouncedValue(q, 250);

  // Keep selectedCache synced when we have it in the current items
  useEffect(() => {
    if (!value) {
      setSelectedCache(null);
      return;
    }
    const found = items.find((c) => c.id === value);
    if (found) setSelectedCache(found);
  }, [value, items]);

  useEffect(() => {
    if (!open) return;

    let alive = true;
    setLoading(true);
    setErr('');

    const qs = debouncedQ.trim();
    const limit = qs ? 200 : 50;

    // Support BOTH styles, because backend might be `q=` or `search=`
    const endpoint = qs
      ? `/api/clients?search=${encodeURIComponent(qs)}&q=${encodeURIComponent(qs)}&limit=${limit}`
      : `/api/clients?limit=${limit}`;

    void safeGetArray<ClientOption>(endpoint)
      .then((rows) => {
        if (!alive) return;

        // Fallback local filtering (helps if backend ignores search param)
        const nq = normalize(qs);
        const filtered = nq ? rows.filter((c) => matchesClient(c, nq)) : rows;

        // Keep list reasonable in UI
        setItems(filtered.slice(0, 50));
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Failed to load clients';
        if (!alive) return;
        setErr(msg);
        setItems([]);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [debouncedQ, open]);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(ev.target as Node)) {
        setOpen(false);
        setQ(''); // reset search when closing
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const displayValue = open ? q : (selectedCache ? label(selectedCache) : '');

  return (
    <div ref={rootRef} className={disabled ? 'opacity-60 pointer-events-none' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">Client (search + select)</label>

      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={displayValue}
          onFocus={() => {
            setOpen(true);
            setQ(''); // start fresh when opening
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          placeholder={selectedCache ? label(selectedCache) : 'Type client name…'}
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg"
        />
      </div>

      {open && (
        <div className="mt-2 border border-gray-200 rounded-lg bg-white shadow-sm max-h-64 overflow-auto">
          {loading && <div className="px-3 py-2 text-sm text-gray-500">Loading…</div>}
          {err && !loading && <div className="px-3 py-2 text-sm text-red-700">{err}</div>}
          {!loading && !err && items.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">No clients found.</div>
          )}

          {!loading && !err && items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setSelectedCache(c);
                onChange(c.id);
                setOpen(false);
                setQ('');
              }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50"
            >
              <div className="text-sm font-medium text-gray-900">{c.company_name || 'Unnamed'}</div>
              <div className="text-xs text-gray-500">
                {[c.contact_name, c.phone, c.email].filter(Boolean).join(' • ') || '—'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
