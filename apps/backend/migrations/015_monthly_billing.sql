
-- 015_monthly_billing.sql

-- Billing config on branch account
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'transaction'
    CHECK (billing_mode IN ('transaction','monthly')),
  ADD COLUMN IF NOT EXISTS billing_cutoff_day int NOT NULL DEFAULT 31
    CHECK (billing_cutoff_day BETWEEN 1 AND 31);

-- Invoice typed: per transaction OR monthly cut-off
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_type text NOT NULL DEFAULT 'transaction'
    CHECK (invoice_type IN ('transaction','monthly')),
  ADD COLUMN IF NOT EXISTS billing_period_start date,
  ADD COLUMN IF NOT EXISTS billing_period_end date,
  ADD COLUMN IF NOT EXISTS cutoff_date date;

-- Ledger of charges (this is what makes monthly billing safe + auditable)
CREATE TABLE IF NOT EXISTS billing_charges (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,           -- which branch account
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  transaction_id uuid UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,

  service_date date NOT NULL DEFAULT CURRENT_DATE,

  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,

  pricing_engine text DEFAULT '',
  pricing_rule_id uuid,
  pricing_rule_name text,
  pricing_unit_type text,
  pricing_quantity numeric(12,3),
  pricing_unit_price numeric(12,2),

  status text NOT NULL DEFAULT 'unbilled'
    CHECK (status IN ('unbilled','billed','void')),

  billed_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_charges_customer_status_date
ON billing_charges(customer_id, status, service_date);

CREATE INDEX IF NOT EXISTS idx_billing_charges_invoice_id
ON billing_charges(billed_invoice_id);

-- updated_at trigger (if you already have set_updated_at() from 002, this is safe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_billing_charges_updated_at') THEN
      CREATE TRIGGER trg_billing_charges_updated_at
      BEFORE UPDATE ON billing_charges
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;

