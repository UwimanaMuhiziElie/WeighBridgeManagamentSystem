-- 018_monthly_invoice_unique_period.sql

-- Enforce "one active monthly invoice per customer per period"
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_monthly_period_active
ON invoices(customer_id, billing_period_start, billing_period_end, cutoff_date)
WHERE invoice_type = 'monthly' AND status <> 'cancelled';

-- Helpful lookup index (optional)
CREATE INDEX IF NOT EXISTS idx_invoices_monthly_lookup
ON invoices(customer_id, billing_period_start, billing_period_end)
WHERE invoice_type = 'monthly';
