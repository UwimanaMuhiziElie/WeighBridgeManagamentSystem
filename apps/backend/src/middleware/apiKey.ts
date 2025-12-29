import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import net from 'node:net';
import { query } from '../db.js';

export interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string;
    branch_id: string;
    permissions: string[];
    rate_limit: number;
    ip_whitelist: string[] | null;
  };
}

// In-memory rate limiting + last_used throttling (OK for single instance).
// If you run multiple backend instances, move this to Redis.
const RATE_WINDOW_MS = 60_000;
const rateState = new Map<string, { windowStart: number; count: number }>();
const lastUsedTouch = new Map<string, number>();

function hashApiKey(apiKey: string): string {
  // Optional pepper (recommended). If not set, it still works.
  const pepper = process.env.API_KEY_PEPPER || '';
  return crypto.createHash('sha256').update(`${pepper}${apiKey}`).digest('hex');
}

function getClientIp(req: Request): string | null {
  // Only trust forwarded headers if you explicitly enabled trust proxy.
  const trustProxy = !!req.app.get('trust proxy');

  let ip: string | undefined;

  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      ip = xff.split(',')[0].trim(); // first IP is the client
    } else {
      const xri = req.headers['x-real-ip'];
      if (typeof xri === 'string' && xri.trim()) ip = xri.trim();
    }
  }

  ip = ip || req.ip || req.socket?.remoteAddress || undefined;
  if (!ip) return null;

  // Normalize IPv4-mapped IPv6 like ::ffff:127.0.0.1
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);

  // Strip port if present (e.g. 1.2.3.4:1234 or [::1]:1234)
  const bracketMatch = ip.match(/^\[([0-9a-fA-F:]+)\]:(\d+)$/);
  if (bracketMatch) ip = bracketMatch[1];

  const ipv4PortMatch = ip.match(/^(\d{1,3}(\.\d{1,3}){3}):\d+$/);
  if (ipv4PortMatch) ip = ipv4PortMatch[1];

  return ip;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4) return null;
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function ipv4CidrMatch(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;

  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1) >>> 0) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isWhitelisted(ip: string, whitelist: string[]): boolean {
  // Exact match OR IPv4 CIDR match (e.g. 10.0.0.0/24)
  for (const entryRaw of whitelist) {
    const entry = String(entryRaw || '').trim();
    if (!entry) continue;

    if (entry === ip) return true;

    if (entry.includes('/') && net.isIP(ip) === 4) {
      if (ipv4CidrMatch(ip, entry)) return true;
    }
  }
  return false;
}

function normalizeArrayField(v: any): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    // support JSON stored as string
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
  }
  return [];
}

export const verifyApiKey = async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  const rawKey = req.headers['x-api-key'];

  const apiKey =
    typeof rawKey === 'string' ? rawKey.trim() :
    Array.isArray(rawKey) ? String(rawKey[0] || '').trim() :
    '';

  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'API key required' });
  }

  try {
    const keyHash = hashApiKey(apiKey);

    const result = await query(
      `SELECT id, branch_id, permissions, rate_limit, ip_whitelist, expires_at
       FROM api_keys
       WHERE key_hash = $1 AND is_active = true
       LIMIT 1`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    const row = result.rows[0];

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ success: false, error: 'API key expired' });
    }

    const permissions = normalizeArrayField(row.permissions);
    const whitelist = row.ip_whitelist ? normalizeArrayField(row.ip_whitelist) : null;

    // IP whitelist check (only if list provided)
    if (whitelist && whitelist.length > 0) {
      const ip = getClientIp(req);
      if (!ip || !isWhitelisted(ip, whitelist)) {
        return res.status(403).json({ success: false, error: 'IP address not whitelisted' });
      }
    }

    // Rate limit enforcement (requests per minute per API key)
    const limit = Number(row.rate_limit || 0); // 0 => no limit
    if (Number.isFinite(limit) && limit > 0) {
      const now = Date.now();
      const state = rateState.get(row.id);

      if (!state || now - state.windowStart >= RATE_WINDOW_MS) {
        rateState.set(row.id, { windowStart: now, count: 1 });
      } else {
        state.count += 1;
        if (state.count > limit) {
          return res.status(429).json({ success: false, error: 'Rate limit exceeded' });
        }
      }
    }

    // Avoid writing last_used_at on every request (write amplification)
    const now = Date.now();
    const lastTouch = lastUsedTouch.get(row.id) || 0;
    if (now - lastTouch > 60_000) {
      lastUsedTouch.set(row.id, now);
      await query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]);
    }

    req.apiKey = {
      id: row.id,
      branch_id: row.branch_id,
      permissions,
      rate_limit: Number(row.rate_limit || 0),
      ip_whitelist: whitelist,
    };

    next();
  } catch (error) {
    console.error('API key verification error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const requirePermission = (permission: string) => {
  return (req: ApiKeyRequest, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!req.apiKey.permissions.includes(permission) && !req.apiKey.permissions.includes('*')) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }

    next();
  };
};

export async function logApiCall(
  apiKeyId: string | null,
  endpoint: string,
  method: string,
  statusCode: number,
  requestBody: any,
  responseBody: any,
  ipAddress: string | null,
  userAgent: string | null,
  errorMessage: string | null,
  durationMs: number
) {
  try {
    await query(
      `INSERT INTO api_audit_logs
       (api_key_id, endpoint, method, status_code, request_body, response_body,
        ip_address, user_agent, error_message, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        apiKeyId,
        endpoint,
        method,
        statusCode,
        requestBody,
        responseBody,
        ipAddress,
        userAgent,
        errorMessage,
        durationMs,
      ]
    );
  } catch (error) {
    console.error('Error logging API call:', error);
  }
}
