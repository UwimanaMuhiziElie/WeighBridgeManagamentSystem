-- 009_xxx_and_assigned_id_walkin.sql

-- 1) transactions: allow walk-ins
-- Make DROP NOT NULL idempotent
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'transactions'
      AND a.attname = 'client_id'
      AND a.attnotnull = true
  ) THEN
    ALTER TABLE transactions ALTER COLUMN client_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'transactions'
      AND a.attname = 'vehicle_id'
      AND a.attnotnull = true
  ) THEN
    ALTER TABLE transactions ALTER COLUMN vehicle_id DROP NOT NULL;
  END IF;
END $$;

-- 2) new fields required by business flow
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS assigned_truck_id INTEGER,
  ADD COLUMN IF NOT EXISTS truck_side_number VARCHAR(60),
  ADD COLUMN IF NOT EXISTS walk_in_name VARCHAR(120);

-- 3) index
CREATE INDEX IF NOT EXISTS idx_transactions_branch_assigned_open
  ON transactions(branch_id, assigned_truck_id)
  WHERE status IN ('pending','in_progress');
