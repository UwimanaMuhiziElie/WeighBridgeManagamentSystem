-- 003_invoice_transaction_link.sql

-- Link invoice to exactly one transaction (idempotency anchor)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS transaction_id uuid;

-- FK (safe default: keep invoice even if tx removed in dev/test; production shouldn't delete tx)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_transaction_id'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_transaction_id
      FOREIGN KEY (transaction_id)
      REFERENCES transactions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Enforce "one invoice per transaction"
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_transaction_id
ON invoices(transaction_id)
WHERE transaction_id IS NOT NULL;

-- Optional: speed lookups (already covered by unique index, but harmless)
-- CREATE INDEX IF NOT EXISTS idx_invoices_transaction_id ON invoices(transaction_id);

-- Optional backfill (only if you already created invoices with line items linking to a tx)
-- This picks the first transaction_id found per invoice.
UPDATE invoices i
SET transaction_id = x.transaction_id
FROM (
  SELECT DISTINCT ON (invoice_id) invoice_id, transaction_id
  FROM invoice_line_items
  WHERE transaction_id IS NOT NULL
  ORDER BY invoice_id, created_at ASC NULLS LAST
) x
WHERE i.id = x.invoice_id
  AND i.transaction_id IS NULL;
