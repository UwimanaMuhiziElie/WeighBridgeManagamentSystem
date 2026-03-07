
--021_pricing_rule_snapshot.sql
BEGIN;

-- invoices: store which pricing engine + rule priced this invoice
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pricing_engine     text,
  ADD COLUMN IF NOT EXISTS pricing_rule_id    uuid,
  ADD COLUMN IF NOT EXISTS pricing_rule_name  text,
  ADD COLUMN IF NOT EXISTS pricing_rule_priority int;

-- invoice line items: store rule snapshot per line (optional but very useful)
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS pricing_engine     text,
  ADD COLUMN IF NOT EXISTS pricing_rule_id    uuid,
  ADD COLUMN IF NOT EXISTS pricing_rule_name  text,
  ADD COLUMN IF NOT EXISTS pricing_rule_priority int;

-- billing charges: if your code also writes rule snapshot here
ALTER TABLE billing_charges
  ADD COLUMN IF NOT EXISTS pricing_engine     text,
  ADD COLUMN IF NOT EXISTS pricing_rule_id    uuid,
  ADD COLUMN IF NOT EXISTS pricing_rule_name  text,
  ADD COLUMN IF NOT EXISTS pricing_rule_priority int;

-- Optional indexes for faster reporting / debugging
CREATE INDEX IF NOT EXISTS idx_invoices_pricing_rule_id
  ON invoices (pricing_rule_id);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_pricing_rule_id
  ON invoice_line_items (pricing_rule_id);

CREATE INDEX IF NOT EXISTS idx_billing_charges_pricing_rule_id
  ON billing_charges (pricing_rule_id);

COMMIT;
