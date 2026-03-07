-- 019_pricing_rules_allow_item_unit.sql

DO $$
BEGIN
  -- Drop existing check constraint if it exists (name differs per install)
  -- If you know your constraint name, replace it directly.
  -- Otherwise, this dynamic approach is safer.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'pricing_rules'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%unit_type%'
  ) THEN
    -- You may need to manually drop the exact constraint if your DB has multiple checks.
    -- Prefer naming your check constraint explicitly going forward.
  END IF;
END $$;

-- The clean approach (if you can safely drop by name):
-- ALTER TABLE pricing_rules DROP CONSTRAINT pricing_rules_unit_type_check;

ALTER TABLE pricing_rules
  DROP CONSTRAINT IF EXISTS pricing_rules_unit_type_check;

ALTER TABLE pricing_rules
  ADD CONSTRAINT pricing_rules_unit_type_check
  CHECK (unit_type IN ('kg','ton','lb','item'));
