import { PricingTier, ClientPricing } from '../types';

export function generateTransactionNumber(branchCode: string): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const time = date.getTime().toString().slice(-6);

  return `${branchCode}-${year}${month}${day}-${time}`;
}

export function calculateTransactionCost(
  netWeight: number,
  standardPricing: PricingTier | null,
  clientPricing: ClientPricing | null
): { subtotal: number; breakdown: string } {
  let pricePerWeighing = 0;
  let pricePerKg = 0;
  let minimumCharge = 0;
  let discountPercentage = 0;

  if (clientPricing) {
    pricePerWeighing = clientPricing.price_per_weighing ?? standardPricing?.price_per_weighing ?? 0;
    pricePerKg = clientPricing.price_per_kg ?? standardPricing?.price_per_kg ?? 0;
    minimumCharge = clientPricing.minimum_charge ?? standardPricing?.minimum_charge ?? 0;
    discountPercentage = clientPricing.discount_percentage ?? 0;
  } else if (standardPricing) {
    pricePerWeighing = standardPricing.price_per_weighing;
    pricePerKg = standardPricing.price_per_kg;
    minimumCharge = standardPricing.minimum_charge;
  }

  const weighingCharge = pricePerWeighing;
  const weightCharge = netWeight * pricePerKg;
  let subtotal = weighingCharge + weightCharge;

  if (subtotal < minimumCharge) {
    subtotal = minimumCharge;
  }

  if (discountPercentage > 0) {
    subtotal = subtotal * (1 - discountPercentage / 100);
  }

  const breakdown = `Weighing: $${weighingCharge.toFixed(2)} + Weight (${netWeight.toFixed(2)}kg × $${pricePerKg.toFixed(2)}): $${weightCharge.toFixed(2)}${discountPercentage > 0 ? ` - ${discountPercentage}% discount` : ''}`;

  return { subtotal, breakdown };
}

export function generateInvoiceNumber(branchCode: string, sequence: number): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const seq = sequence.toString().padStart(5, '0');

  return `INV-${branchCode}-${year}${month}-${seq}`;
}

export function generatePaymentNumber(branchCode: string, sequence: number): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const seq = sequence.toString().padStart(5, '0');

  return `PAY-${branchCode}-${year}${month}-${seq}`;
}
