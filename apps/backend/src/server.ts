import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import transactionsApiRoutes from './routes/api/transactions.js';
import branchesApiRoutes from './routes/api/branches.js';
import clientsApiRoutes from './routes/api/clients.js';
import invoicesApiRoutes from './routes/api/invoices.js';
import pricingRulesRouter from './routes/api/pricingRules';
import attendanceApiRoutes from './routes/api/attendance.js';
import usersApiRoutes from './routes/api/users.js';
import apiKeysRoutes from './routes/api/apiKeys.js';
import vehiclesApiRoutes from './routes/api/vehicles.js';
import pricingApiRoutes from './routes/api/pricing.js';
import reportsApiRoutes from './routes/api/reports.js';
import analyticsApiRoutes from './routes/api/analytics.js';


// ✅ moved from /api to /integrations
import webhooksIntegrationsRoutes from './routes/integrations/webhooks.js';

import { pool } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.disable('x-powered-by');

// Trust proxy ONLY if explicitly enabled (avoid spoofed IPs by default)
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// ---- CORS (production-safe defaults) ----
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const isProd = process.env.NODE_ENV === 'production';

app.use(
  cors({
    origin: (origin, callback) => {
      // allow non-browser tools (curl/postman) with no Origin header
      if (!origin) return callback(null, true);

      // dev: allow all if not configured
      if (!isProd && allowedOrigins.length === 0) return callback(null, true);

      // prod: require explicit allowlist
      if (allowedOrigins.includes(origin)) return callback(null, true);

      return callback(new Error('CORS blocked'), false);
    },
    credentials: process.env.CORS_CREDENTIALS === 'true', // keep false unless you use cookies
  })
);

// ---- Body parsing (✅ rawBody captured for webhook signature verification) ----
app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || '1mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf; // used by /integrations/webhooks signature verification
    },
  })
);

// ---- Request logging (don’t spam prod unless enabled) ----
if (process.env.HTTP_LOG === 'true' || !isProd) {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ---- Routes ----
app.use('/auth', authRoutes);

app.use('/api/transactions', transactionsApiRoutes);
app.use('/api/branches', branchesApiRoutes);
app.use('/api/clients', clientsApiRoutes);
app.use('/api/invoices', invoicesApiRoutes);
app.use('/api/pricing-rules', pricingRulesRouter);
app.use('/api/attendance', attendanceApiRoutes);
app.use('/api/users', usersApiRoutes);
app.use('/api/api-keys', apiKeysRoutes);
app.use('/api/vehicles', vehiclesApiRoutes);
app.use('/api/pricing', pricingApiRoutes);
app.use('/api/reports', reportsApiRoutes);
app.use('/api/analytics', analyticsApiRoutes);



// ✅ new integrations endpoint
app.use('/integrations/webhooks', webhooksIntegrationsRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---- Error handler (don’t leak details) ----
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  try {
    await pool.query('SELECT NOW()');
    console.log('Database connection established');

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
