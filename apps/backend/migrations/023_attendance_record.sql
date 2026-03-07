-- 023_attendance_records.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  hours_worked numeric(5,2) NOT NULL DEFAULT 0,
  shift_start timestamptz,
  shift_end timestamptz,
  transactions_processed integer NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, operator_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_branch_date
  ON attendance_records(branch_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_operator_date
  ON attendance_records(operator_id, date DESC);

-- If set_updated_at() exists, keep updated_at fresh
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_records_updated_at') THEN
      CREATE TRIGGER trg_attendance_records_updated_at
      BEFORE UPDATE ON attendance_records
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;
