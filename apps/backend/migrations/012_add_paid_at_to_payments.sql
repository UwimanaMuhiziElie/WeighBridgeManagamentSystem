-- 012_add_paid_at_to_payments.sql
-- Ensure payments have a paid_at timestamp (required by payments.ts + reporting)

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Backfill existing rows (use created_at as best approximation)
UPDATE payments
SET paid_at = created_at
WHERE paid_at IS NULL;

-- Default for future inserts
ALTER TABLE payments
ALTER COLUMN paid_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
