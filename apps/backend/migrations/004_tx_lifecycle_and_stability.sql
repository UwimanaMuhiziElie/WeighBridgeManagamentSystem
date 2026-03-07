-- 004_tx_lifecycle_and_stability.sql

-- If status is an ENUM, you MUST allow 'cancelled'
-- Uncomment if you use enum type (change name if different):
-- DO $$
-- BEGIN
--   ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'cancelled';
-- EXCEPTION WHEN duplicate_object THEN
--   NULL;
-- END $$;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_reason text DEFAULT '',

  -- Step 4 columns (stable capture metadata)
  ADD COLUMN IF NOT EXISTS first_weight_stable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_weight_stability_ms integer,
  ADD COLUMN IF NOT EXISTS first_weight_tolerance_kg numeric(12,2),

  ADD COLUMN IF NOT EXISTS second_weight_stable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS second_weight_stability_ms integer,
  ADD COLUMN IF NOT EXISTS second_weight_tolerance_kg numeric(12,2);

CREATE INDEX IF NOT EXISTS idx_transactions_branch_status_created
  ON transactions(branch_id, status, created_at DESC);
