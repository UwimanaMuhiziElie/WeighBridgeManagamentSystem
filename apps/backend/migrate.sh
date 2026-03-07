#!/bin/sh
set -eu

# -----------------------------
# Connection resolution
# - Prefer DATABASE_URL if present
# - Otherwise use POSTGRES_* + optional POSTGRES_HOST/POSTGRES_PORT
# -----------------------------
DB_URL="${DATABASE_URL:-}"

PGHOST="${POSTGRES_HOST:-db}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-postgres}"
PGDATABASE="${POSTGRES_DB:-postgres}"
PGPASSWORD="${POSTGRES_PASSWORD:-}"

psql_cmd() {
  if [ -n "$DB_URL" ]; then
    psql "$DB_URL" -X -v ON_ERROR_STOP=1 "$@"
  else
    export PGPASSWORD
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -X -v ON_ERROR_STOP=1 "$@"
  fi
}

pgready_cmd() {
  if [ -n "$DB_URL" ]; then
    pg_isready -d "$DB_URL" >/dev/null 2>&1
  else
    export PGPASSWORD
    pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1
  fi
}

# Escape a string for SQL single-quoted literal
sql_quote() {
  # double any single quotes
  printf "%s" "$1" | sed "s/'/''/g"
}

# Optional: advisory lock to prevent concurrent migrations
LOCK_KEY="${MIGRATION_LOCK_KEY:-81234012}"

release_lock() {
  echo "Releasing migration lock..."
  # don't fail if not held
  psql_cmd -qAt -c "SELECT pg_advisory_unlock($LOCK_KEY);" >/dev/null 2>&1 || true
}

trap release_lock EXIT INT TERM

echo "Waiting for DB..."
until pgready_cmd; do
  sleep 1
done

echo "Acquiring migration lock..."
psql_cmd -qAt -c "SELECT pg_advisory_lock($LOCK_KEY);" >/dev/null

echo "Ensuring schema_migrations table..."
psql_cmd -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

echo "Listing migrations:"
ls -la /migrations || true

# Busybox-friendly globbing
set +e
MIGS=$(ls -1 /migrations/*.sql 2>/dev/null | sort)
set -e

if [ -z "${MIGS:-}" ]; then
  echo "No .sql migration files found in /migrations. Exiting."
  exit 0
fi

echo "Running migrations in order..."
for f in $MIGS; do
  [ -n "$f" ] || continue
  name="$(basename "$f")"
  qname="$(sql_quote "$name")"

  applied="$(psql_cmd -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$qname' LIMIT 1;")"
  if [ "$applied" = "1" ]; then
    echo "Skipping already applied: $name"
    continue
  fi

  echo "Applying: $name"
  psql_cmd -f "$f"
  psql_cmd -c "INSERT INTO schema_migrations(filename) VALUES ('$qname');"
  echo "Applied: $name"
done

echo "All migrations done."
