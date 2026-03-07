-- 022_pricing_rules_allow_mattress_count.sql
-- Expands allowed unit_type values to include mattress + count (non-weight items)

DO $$
DECLARE
  conname text;
BEGIN
  -- Find any CHECK constraint on pricing_rules that references unit_type
  SELECT c.conname
  INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'pricing_rules'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%unit_type%';

  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE pricing_rules DROP CONSTRAINT IF EXISTS %I', conname);
  END IF;
END $$;

-- Recreate as a known name (stable for future migrations)
ALTER TABLE pricing_rules
  ADD CONSTRAINT pricing_rules_unit_type_check
  CHECK (unit_type = ANY (ARRAY[
    'kg'::text,
    'ton'::text,
    'lb'::text,
    'item'::text,
    'mattress'::text,
    'count'::text
  ]));
