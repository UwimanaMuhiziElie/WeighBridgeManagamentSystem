import { PricingTier, ClientPricing } from '../types';
import { formatCurrency } from './index';

type Num = number | string | null | undefined;

function toNumber(v: Num, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;

  if (typeof v === 'string') {
    const cleaned = v.trim().replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }

  return fallback;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function generateTransactionNumber(branchCode: string): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${branchCode}-${year}${month}${day}-${rand}`;
}

export function calculateTransactionCost(
  netWeight: number,
  standardPricing: PricingTier | null,
  clientPricing: ClientPricing | null,
  opts?: { currency?: string; locale?: string }
): { subtotal: number; breakdown: string } {
  const safeWeight = Number.isFinite(netWeight) && netWeight > 0 ? netWeight : 0;
  const tierPricePerWeighing = toNumber((standardPricing as any)?.price_per_weighing, 0);
  const tierPricePerKg = toNumber((standardPricing as any)?.price_per_kg, 0);
  const tierMinimum = toNumber((standardPricing as any)?.minimum_charge, 0);

  const pricePerWeighingRaw =
    (clientPricing as any)?.price_per_weighing ?? tierPricePerWeighing;

  const pricePerKgRaw =
    (clientPricing as any)?.price_per_kg ?? tierPricePerKg;

  const minimumChargeRaw =
    (clientPricing as any)?.minimum_charge ?? tierMinimum;

  const discountPercentageRaw = (clientPricing as any)?.discount_percentage ?? 0;
  const ppw = toNumber(pricePerWeighingRaw, 0);
  const ppk = toNumber(pricePerKgRaw, 0);
  const min = toNumber(minimumChargeRaw, 0);
  const disc = toNumber(discountPercentageRaw, 0);
  const weighingCharge = round2(ppw);
  const weightCharge = round2(safeWeight * ppk);

  let subtotal = round2(weighingCharge + weightCharge);

  const minApplied = subtotal < min;
  if (minApplied) subtotal = round2(min);

  const discApplied = disc > 0;
  if (discApplied) {
    subtotal = round2(subtotal * (1 - disc / 100));
  }

  const parts: string[] = [];
  parts.push(`Weighing: ${formatCurrency(weighingCharge, opts)}`);
  parts.push(
    `Weight: ${safeWeight.toFixed(2)} kg × ${formatCurrency(ppk, opts)} = ${formatCurrency(weightCharge, opts)}`
  );

  if (minApplied) parts.push(`Minimum charge applied: ${formatCurrency(min, opts)}`);
  if (discApplied) parts.push(`Discount: ${round2(disc)}%`);

  return {
    subtotal,
    breakdown: parts.join(' | '),
  };
}

export function generateInvoiceNumber(branchCode: string, sequence: number): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const seq = String(Math.max(0, sequence | 0)).padStart(5, '0');

  return `INV-${branchCode}-${year}${month}-${seq}`;
}

export function generatePaymentNumber(branchCode: string, sequence: number): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const seq = String(Math.max(0, sequence | 0)).padStart(5, '0');

  return `PAY-${branchCode}-${year}${month}-${seq}`;
}
