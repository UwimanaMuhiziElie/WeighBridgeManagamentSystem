-- 002_align_schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;

-- 1) USERS: make email case-insensitive + add branch_id
ALTER TABLE users
  ALTER COLUMN email TYPE citext;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_users_branch_id ON users(branch_id);

-- 2) BRANCHES: add columns your API expects
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone text DEFAULT '',
  ADD COLUMN IF NOT EXISTS email text DEFAULT '';

-- 2 steps:
-- (a) ensure existing rows have code values, then:
-- ALTER TABLE branches ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_code ON branches(code) WHERE code IS NOT NULL;

-- 3) PRICING: match your AdminPricingPage model
CREATE TABLE IF NOT EXISTS pricing_tiers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  price_per_weighing numeric(12,2) NOT NULL DEFAULT 0,
  price_per_kg numeric(12,2) NOT NULL DEFAULT 0,
  minimum_charge numeric(12,2) NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(branch_id, name)
);

-- Only one default per branch (active)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_tiers_one_default_per_branch
ON pricing_tiers(branch_id)
WHERE is_default = true AND is_active = true;

CREATE TABLE IF NOT EXISTS client_pricing (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pricing_tier_id uuid REFERENCES pricing_tiers(id) ON DELETE SET NULL,

  -- optional overrides (if null, inherit from tier)
  price_per_weighing numeric(12,2),
  price_per_kg numeric(12,2),
  minimum_charge numeric(12,2),

  discount_percentage numeric(5,2) NOT NULL DEFAULT 0,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_until date,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_pricing_client_id ON client_pricing(client_id);

-- 4) updated_at auto-update triggers
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_branches_updated_at') THEN
    CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON branches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clients_updated_at') THEN
    CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_invoices_updated_at') THEN
    CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
