-- 011_branch_gst_settings.sql
-- Add per-branch GST/VAT settings (safe defaults)

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS gst_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_gst_rate_check'
  ) THEN
    ALTER TABLE branches
      ADD CONSTRAINT branches_gst_rate_check CHECK (gst_rate >= 0 AND gst_rate <= 100);
  END IF;
END $$;

-- Optional: enable GST for all branches (ONLY if you're ready)
-- UPDATE branches SET gst_enabled = true, gst_rate = 5.00;
