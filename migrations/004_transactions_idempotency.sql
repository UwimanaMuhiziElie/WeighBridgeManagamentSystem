-- 004_transactions_idempotency.sql

-- Add idempotency key for "first weight" creation
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS client_request_id text;

-- One create request => one transaction (per branch)
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_branch_client_request_id
ON transactions(branch_id, client_request_id)
WHERE client_request_id IS NOT NULL;
