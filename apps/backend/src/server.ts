// apps/backend/src/server.ts
import express from 'express';
import cors, { type CorsOptions } from 'cors';
// import dotenv from 'dotenv';
// dotenv.config();

import authRoutes from './routes/auth.js';
import transactionsApiRoutes from './routes/api/transactions.js';
import branchesApiRoutes from './routes/api/branches.js';
import clientsApiRoutes from './routes/api/clients.js';
import invoicesApiRoutes from './routes/api/invoices.js';
import pricingRulesRouter from './routes/api/pricingRules.js';
import attendanceApiRoutes from './routes/api/attendance.js';
import usersApiRoutes from './routes/api/users.js';
import apiKeysRoutes from './routes/api/apiKeys.js';
import vehiclesApiRoutes from './routes/api/vehicles.js';
import pricingApiRoutes from './routes/api/pricing.js';
import reportsApiRoutes from './routes/api/reports.js';
import analyticsApiRoutes from './routes/api/analytics.js';
import paymentsApiRoutes from './routes/api/payments.js';
import webhooksIntegrationsRoutes from './routes/integrations/webhooks.js';
import customersApiRoutes from './routes/api/customers.js';
import billingApiRoutes from './routes/api/billing.js';

import { pool } from './db.js';

const app = express();

const portRaw = process.env.PORT ?? '3001';
const PORT = Number(portRaw);
if (!Number.isFinite(PORT) || PORT <= 0) {
  throw new Error(`Invalid PORT: ${portRaw}`);
}

const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');

// Trust proxy ONLY if explicitly enabled
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

const isProd = process.env.NODE_ENV === 'production';

// ---- CORS ----
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isDevLocalOrigin(origin: string) {
  return /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
}

// Only allow Origin: null if explicitly permitted (needed for packaged Electron file://)
const allowNullOrigin = !isProd || process.env.CORS_ALLOW_NULL_ORIGIN === 'true';

const allowCredentials =
  typeof process.env.CORS_CREDENTIALS !== 'undefined'
    ? process.env.CORS_CREDENTIALS === 'true'
    : !isProd;

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // no Origin header (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);

    // file:// / sandboxed origins often show up as "null"
    if (origin === 'null') {
      if (allowNullOrigin) return callback(null, true);
      return callback(new Error('CORS blocked for origin: null'), false);
    }

    // dev convenience
    if (!isProd && isDevLocalOrigin(origin)) return callback(null, true);
    if (!isProd && allowedOrigins.length === 0) return callback(null, true);

    // strict allowlist
    if (allowedOrigins.includes(origin)) return callback(null, true);

    return callback(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: allowCredentials,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-Webhook-Signature',
    'X-Webhook-Timestamp',
    'X-Webhook-Id',
    'X-Event-Id',
    'X-Request-Id',
  ],
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ---- Body parsing (capture rawBody for webhook signature verification) ----
app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || '1mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---- Request logging ----
if (process.env.HTTP_LOG === 'true' || !isProd) {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ---- Routes ----
app.use(['/auth', '/api/auth'], authRoutes);

app.use('/api/transactions', transactionsApiRoutes);
app.use('/api/branches', branchesApiRoutes);
app.use('/api/clients', clientsApiRoutes);
app.use('/api/invoices', invoicesApiRoutes);
app.use('/api/pricingRules', pricingRulesRouter);
app.use('/api/attendance', attendanceApiRoutes);
app.use('/api/users', usersApiRoutes);
app.use('/api/apiKeys', apiKeysRoutes);
app.use('/api/vehicles', vehiclesApiRoutes);
app.use('/api/pricing', pricingApiRoutes);
app.use('/api/reports', reportsApiRoutes);
app.use('/api/analytics', analyticsApiRoutes);
app.use('/api/payments', paymentsApiRoutes);
app.use('/integrations/webhooks', webhooksIntegrationsRoutes);
app.use('/api/customers', customersApiRoutes);
app.use('/api/billing', billingApiRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---- Error handler ----
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (typeof err?.message === 'string' && err.message.startsWith('CORS blocked')) {
    console.error('CORS error:', err.message);
    return res.status(403).json({ error: err.message });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  try {
    await pool.query('SELECT NOW()');
    console.log('Database connection established');

    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
