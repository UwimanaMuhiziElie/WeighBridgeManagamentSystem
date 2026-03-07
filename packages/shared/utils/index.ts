// packages/shared/utils/index.ts
const DEFAULT_LOCALE = 'en-CA';
const DEFAULT_CURRENCY = 'CAD';

function getEnvCurrency(): string {
  try {
    const c = (import.meta as any)?.env?.VITE_CURRENCY;
    if (typeof c === 'string' && c.trim()) return c.trim().toUpperCase();
  } catch {}
  const env = typeof process !== 'undefined' ? (process as any)?.env : null;
  const c2 = env?.CURRENCY || env?.VITE_CURRENCY;
  if (typeof c2 === 'string' && c2.trim()) return c2.trim().toUpperCase();
  return DEFAULT_CURRENCY;
}

function getEnvLocale(): string {
  try {
    const l = (import.meta as any)?.env?.VITE_LOCALE;
    if (typeof l === 'string' && l.trim()) return l.trim();
  } catch {}
  const env = typeof process !== 'undefined' ? (process as any)?.env : null;
  const l2 = env?.LOCALE || env?.VITE_LOCALE;
  if (typeof l2 === 'string' && l2.trim()) return l2.trim();
  return DEFAULT_LOCALE;
}

export function formatWeight(weight: number | null, unit: 'kg' | 'ton' = 'kg'): string {
  if (weight === null || !Number.isFinite(weight)) return '-';
  const v = unit === 'ton' ? weight / 1000 : weight;
  const suffix = unit === 'ton' ? ' ton' : ' kg';
  return `${v.toFixed(2)}${suffix}`;
}

export function formatCurrency(
  amount: number,
  opts?: { currency?: string; locale?: string; maximumFractionDigits?: number }
): string {
  const currency = opts?.currency || getEnvCurrency();
  const locale = opts?.locale || getEnvLocale();
  const maxFD = typeof opts?.maximumFractionDigits === 'number' ? opts.maximumFractionDigits : 2;

  const safe = Number.isFinite(amount) ? amount : 0;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: maxFD,
  }).format(safe);
}

export function formatDate(date: string | Date, locale?: string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString(locale || getEnvLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date, locale?: string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString(locale || getEnvLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export * from './transactions';
export * from './reports';
