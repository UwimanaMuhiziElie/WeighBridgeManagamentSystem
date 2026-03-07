
-- 014_customer_id_on_tx_invoices.sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);

UPDATE transactions t
SET customer_id = c.customer_id
FROM clients c
WHERE t.client_id = c.id AND t.customer_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);

UPDATE invoices i
SET customer_id = c.customer_id
FROM clients c
WHERE i.client_id = c.id AND i.customer_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
