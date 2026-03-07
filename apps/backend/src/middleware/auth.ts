// apps/backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    branchId?: string | null;
  };
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (!header) return null;

  // allow "Bearer" or "bearer"
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const token = m[1]?.trim();
  return token ? token : null;
}

function getQueryToken(req: Request): string | null {
  // Only allow token in query string if explicitly enabled.
  if (process.env.AUTH_ALLOW_TOKEN_QUERY !== 'true') return null;

  const q: any = (req as any).query ?? {};
  const token =
    (typeof q.token === 'string' && q.token.trim()) ||
    (typeof q.access_token === 'string' && q.access_token.trim()) ||
    (typeof q.jwt === 'string' && q.jwt.trim());

  return token ? String(token).trim() : null;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = getBearerToken(req) || getQueryToken(req);

  if (!token) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET is not set');
    return res.status(500).json({ success: false, error: 'Server misconfiguration' });
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;

    // Enforce token "type" when present (new tokens have type="access")
    if (decoded?.type && decoded.type !== 'access') {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ success: false, error: 'Invalid token type' });
    }

    // Support new (sub) and old (userId)
    const userId = decoded.sub || decoded.userId;
    const role = decoded.role;

    if (!userId || !role) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const email = decoded.email ? String(decoded.email) : '';

    const branchId =
      typeof decoded.branchId === 'string'
        ? decoded.branchId
        : typeof decoded.branch_id === 'string'
          ? decoded.branch_id
          : null;

    req.user = {
      id: String(userId),
      email,
      role: String(role),
      branchId,
    };

    return next();
  } catch {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    return next();
  };
};
