import { query } from '../db.js';

type PricingResult = {
  rule_id: string;
  unit_type: 'kg' | 'ton' | 'lb' | 'item';
  unit_price: number;
  quantity: number;
  amount: number;
  description: string;
};

function toNumber(v: any, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function kgToUnit(netKg: number, unit: 'kg' | 'ton' | 'lb') {
  if (unit === 'kg') return netKg;
  if (unit === 'ton') return netKg / 1000;
  return netKg * 2.2046226218;
}

// ✅ Use Kigali date to avoid UTC off-by-one
function isoDateInKigali(d: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kigali',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d); // YYYY-MM-DD
}

export async function resolvePricing(params: {
  branch_id: string;
  net_weight_kg: number;
  client_id?: string | null;
  material_type?: string | null;
  vehicle_type?: string | null;
  item_count?: number | null;
  at?: Date;
}): Promise<PricingResult | null> {
  const at = params.at ?? new Date();
  const atISO = isoDateInKigali(at);

  const clientId = params.client_id ?? null;
  const material = (params.material_type ?? '').trim() || null;
  const vehicle = (params.vehicle_type ?? '').trim() || null;

  const netKg = toNumber(params.net_weight_kg, 0);
  if (!(netKg > 0)) return null;

  const r = await query(
    `
    SELECT
      id, name, material_type, vehicle_type, client_id,
      min_weight, max_weight, price_per_unit, unit_type,
      priority, created_at
    FROM pricing_rules
    WHERE branch_id = $1
      AND is_active = true
      AND (effective_from IS NULL OR effective_from <= $2::date)
      AND (effective_until IS NULL OR effective_until >= $2::date)

      AND (
        ($3::uuid IS NULL AND client_id IS NULL)
        OR ($3::uuid IS NOT NULL AND (client_id = $3 OR client_id IS NULL))
      )

      AND ($4::text IS NULL OR material_type IS NULL OR material_type = '' OR lower(material_type) = lower($4))
      AND ($5::text IS NULL OR vehicle_type IS NULL OR vehicle_type = '' OR lower(vehicle_type) = lower($5))

      AND (min_weight IS NULL OR $6::numeric >= min_weight)
      AND (max_weight IS NULL OR $6::numeric < max_weight)

    ORDER BY
      (client_id IS NOT NULL AND client_id = $3) DESC,
      (material_type IS NOT NULL AND material_type <> '') DESC,
      (vehicle_type IS NOT NULL AND vehicle_type <> '') DESC,
      priority DESC,
      COALESCE(min_weight, 0) DESC,
      COALESCE(max_weight, 999999999) ASC,
      created_at DESC
    LIMIT 1
    `,
    [params.branch_id, atISO, clientId, material, vehicle, netKg]
  );

  if (r.rows.length === 0) return null;
  const rule = r.rows[0];

  const unit_type = String(rule.unit_type || 'kg') as PricingResult['unit_type'];
  const unit_price = toNumber(rule.price_per_unit, 0);

  let quantity = 0;

  if (unit_type === 'item') {
    const c = params.item_count ?? 0;
    if (!Number.isInteger(c) || c <= 0) return null;
    quantity = c;
  } else {
    quantity = kgToUnit(netKg, unit_type);
  }

  const amount = round2(unit_price * quantity);

  const descParts = [
    String(rule.name || '').trim(),
    rule.material_type ? `Material: ${rule.material_type}` : '',
    unit_type === 'item' ? `Qty: ${quantity}` : `Net: ${netKg.toFixed(2)} kg`,
  ].filter(Boolean);

  return {
    rule_id: rule.id,
    unit_type,
    unit_price: round2(unit_price),
    quantity,
    amount,
    description: descParts.join(' | '),
  };
}
