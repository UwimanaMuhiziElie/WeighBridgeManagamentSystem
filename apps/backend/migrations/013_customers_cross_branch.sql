
-- 013_customers_cross_branch.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;

-- Global customer (cross-branch identity)
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name text NOT NULL,
  contact_person text DEFAULT '',
  phone text DEFAULT '',
  email citext,
  address text DEFAULT '',
  tax_id text DEFAULT '',
  payment_terms text DEFAULT 'Net 30',
  credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  primary_branch_id uuid REFERENCES branches(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Helpful uniqueness (optional)
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tax_id
ON customers(lower(tax_id))
WHERE tax_id IS NOT NULL AND tax_id <> '';

-- Your existing table "clients" becomes "branch account" for a customer
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Backfill: create 1 customer per existing client row
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='customer_id')
  THEN
    CREATE TEMP TABLE tmp_client_customer_map AS
    SELECT c.id AS client_id, uuid_generate_v4() AS customer_id
    FROM clients c
    WHERE c.customer_id IS NULL;

    INSERT INTO customers
      (id, company_name, contact_person, phone, email, address, tax_id, payment_terms,
       credit_limit, current_balance, primary_branch_id, is_active)
    SELECT
      m.customer_id,
      c.company_name,
      c.contact_person,
      c.phone,
      c.email,
      c.address,
      c.tax_id,
      c.payment_terms,
      COALESCE(c.credit_limit, 0),
      COALESCE(c.current_balance, 0),
      c.branch_id,
      COALESCE(c.is_active, true)
    FROM clients c
    JOIN tmp_client_customer_map m ON m.client_id = c.id;

    UPDATE clients c
    SET customer_id = m.customer_id,
        is_primary = true
    FROM tmp_client_customer_map m
    WHERE c.id = m.client_id;
  END IF;
END $$;

-- One branch account per (branch, customer)
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_branch_customer
ON clients(branch_id, customer_id)
WHERE branch_id IS NOT NULL AND customer_id IS NOT NULL;

-- Only one primary branch account per customer
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_one_primary_per_customer
ON clients(customer_id)
WHERE is_primary = true AND customer_id IS NOT NULL;

