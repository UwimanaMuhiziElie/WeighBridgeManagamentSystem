-- 008_hardening_constraints.sql
-- Production hardening: idempotency, pricing-period safety, triggers, and useful indexes.

-- (Optional but recommended for exclusion constraints)
-- Requires privileges to CREATE EXTENSION.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping btree_gist (insufficient privileges). Overlap constraint will not be created.';
  END;
END $$;

----------------------------------------------------------------
-- 1) Webhook idempotency: make reference_number a real dedupe key
----------------------------------------------------------------
-- Avoid blocking old rows that have reference_number = '' (default)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_branch_reference_number
ON payments(branch_id, reference_number)
WHERE reference_number IS NOT NULL AND reference_number <> '';

----------------------------------------------------------------
-- 2) Pricing safety: prevent overlapping client pricing periods
----------------------------------------------------------------
-- This ensures a client cannot have overlapping effective periods.
-- It uses inclusive bounds [] which matches your “effective_until is inclusive” behavior.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ex_client_pricing_no_overlap') THEN
    ALTER TABLE client_pricing
      ADD CONSTRAINT ex_client_pricing_no_overlap
      EXCLUDE USING gist (
        client_id WITH =,
        daterange(
          effective_from,
          COALESCE(effective_until, 'infinity'::date),
          '[]'
        ) WITH &&
      );
  END IF;
END $$;

----------------------------------------------------------------
-- 3) Basic checks
----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_client_pricing_discount_range') THEN
    ALTER TABLE client_pricing
      ADD CONSTRAINT chk_client_pricing_discount_range
      CHECK (discount_percentage >= 0 AND discount_percentage <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pricing_tiers_default_must_be_active') THEN
    ALTER TABLE pricing_tiers
      ADD CONSTRAINT chk_pricing_tiers_default_must_be_active
      CHECK (NOT (is_default = true AND is_active = false));
  END IF;
END $$;

----------------------------------------------------------------
-- 4) updated_at triggers for pricing + other tables
----------------------------------------------------------------
-- set_updated_at() already exists from 002, so just add missing triggers.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pricing_tiers_updated_at') THEN
    CREATE TRIGGER trg_pricing_tiers_updated_at
    BEFORE UPDATE ON pricing_tiers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_client_pricing_updated_at') THEN
    CREATE TRIGGER trg_client_pricing_updated_at
    BEFORE UPDATE ON client_pricing
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  -- Optional but useful for consistency:
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_transactions_updated_at') THEN
    CREATE TRIGGER trg_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payments_updated_at') THEN
    CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_vehicles_updated_at') THEN
    CREATE TRIGGER trg_vehicles_updated_at
    BEFORE UPDATE ON vehicles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_api_keys_updated_at') THEN
    CREATE TRIGGER trg_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

----------------------------------------------------------------
-- 5) Indexes that match your API query patterns
----------------------------------------------------------------
-- Analytics/reports filter invoices by created_at; you don’t have this index yet.
CREATE INDEX IF NOT EXISTS idx_invoices_created_at_desc
ON invoices(created_at DESC);

-- Client pricing lookups often search by client_id and effective dates
CREATE INDEX IF NOT EXISTS idx_client_pricing_client_effective_from_desc
ON client_pricing(client_id, effective_from DESC);

-- Webhook dedupe lookups become fast with the unique index already,
-- but this helps if you ever query across branches:
CREATE INDEX IF NOT EXISTS idx_payments_reference_number
ON payments(reference_number)
WHERE reference_number IS NOT NULL AND reference_number <> '';
