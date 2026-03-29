// apps/backend/src/db.ts
import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}


const sslEnabled = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true';
const rejectUnauthorized =
  String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true';

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslEnabled ? { rejectUnauthorized } : false,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 10_000),
});

pool.on('error', (err) => {
  // Idle client had unexpected error; in prod it's often safest to crash+restart
  console.error('Unexpected error on idle PG client', {
    message: err.message,
    name: err.name,
  });
  process.exit(1);
});

function shouldLogQueries() {
  // Do NOT spam prod logs unless explicitly enabled
  return process.env.DB_LOG_QUERIES === 'true' || process.env.NODE_ENV !== 'production';
}

function summarizeSql(sql: string) {
  // Avoid printing full SQL in prod logs
  return sql.trim().split(/\s+/).slice(0, 6).join(' ');
}

function logDbError(error: unknown) {
  const e = error as any;

  // Prod-safe minimal logging:
  if (process.env.NODE_ENV === 'production') {
    console.error('Database query error', {
      code: e?.code,
      message: e?.message || 'Unknown DB error',
    });
    return;
  }

  // Dev: full details
  console.error('Database query error:', error);
}

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();

  try {
    const res = await pool.query(text, params);
    const durationMs = Date.now() - start;

    if (shouldLogQueries()) {
      console.log('DB query', {
        op: summarizeSql(text),
        durationMs,
        rows: res.rowCount,
      });
    }

    return res;
  } catch (error) {
    logDbError(error);
    throw error;
  }
};

// Optional: call this on shutdown (SIGTERM) if you want graceful exit
export async function closeDb() {
  await pool.end();
}