--020_pricing_snapshot_columns.sql

BEGIN;

-- invoices snapshot columns
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pricing_unit_type  text,
  ADD COLUMN IF NOT EXISTS pricing_quantity   numeric,
  ADD COLUMN IF NOT EXISTS pricing_unit_price numeric;

-- invoice line items snapshot columns (your real table is invoice_line_items)
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS pricing_unit_type  text,
  ADD COLUMN IF NOT EXISTS pricing_quantity   numeric,
  ADD COLUMN IF NOT EXISTS pricing_unit_price numeric;

-- billing charges snapshot columns (if your code queries it too)
ALTER TABLE billing_charges
  ADD COLUMN IF NOT EXISTS pricing_unit_type  text,
  ADD COLUMN IF NOT EXISTS pricing_quantity   numeric,
  ADD COLUMN IF NOT EXISTS pricing_unit_price numeric;

COMMIT;
