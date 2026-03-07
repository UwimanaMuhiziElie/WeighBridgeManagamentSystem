-- 007_invoice_pricing_snapshot.sql

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pricing_tier_id uuid REFERENCES pricing_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_pricing_id uuid REFERENCES client_pricing(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_per_weighing numeric(12,2),
  ADD COLUMN IF NOT EXISTS price_per_kg numeric(12,2),
  ADD COLUMN IF NOT EXISTS minimum_charge numeric(12,2),
  ADD COLUMN IF NOT EXISTS discount_percentage numeric(5,2),
  ADD COLUMN IF NOT EXISTS pricing_breakdown text DEFAULT '',
  ADD COLUMN IF NOT EXISTS pricing_calculated_at timestamptz;

-- safety if 003 wasn't applied for any reason
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS transaction_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_transaction_id') THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_transaction_id
      FOREIGN KEY (transaction_id)
      REFERENCES transactions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_transaction_id
ON invoices(transaction_id)
WHERE transaction_id IS NOT NULL;
