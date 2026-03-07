-- 010_allow_invoices_client_nullable.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'invoices'
      AND a.attname = 'client_id'
      AND a.attnotnull = true
  ) THEN
    ALTER TABLE invoices ALTER COLUMN client_id DROP NOT NULL;
  END IF;
END $$;
