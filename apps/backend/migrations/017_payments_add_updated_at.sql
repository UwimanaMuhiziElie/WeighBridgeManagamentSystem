-- 017_payments_add_updated_at.sql

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill
UPDATE payments
SET updated_at = created_at
WHERE updated_at IS NULL;

-- If set_updated_at() exists, add trigger (safe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payments_updated_at') THEN
      CREATE TRIGGER trg_payments_updated_at
      BEFORE UPDATE ON payments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;
