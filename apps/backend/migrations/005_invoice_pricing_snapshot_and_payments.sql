
-- 005_invoice_pricing_snapshot_and_payments.sql

-- Payments: align with existing payments table from 001_initial_schema.sql
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- backfill for old rows
UPDATE payments
SET paid_at = created_at
WHERE paid_at IS NULL;

ALTER TABLE payments
  ALTER COLUMN paid_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_payments_invoice_paidat
  ON payments(invoice_id, paid_at DESC);
