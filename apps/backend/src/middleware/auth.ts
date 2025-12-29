import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;

  const header = Array.isArray(auth) ? auth[0] : auth;
  if (!header.startsWith('Bearer ')) return null;

  return header.slice(7).trim();
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET is not set');
    return res.status(500).json({ success: false, error: 'Server misconfiguration' });
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;

    // Support both styles: old tokens used userId; new tokens use sub.
    const userId = decoded.sub || decoded.userId;

    if (!userId || !decoded.email || !decoded.role) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    req.user = {
      id: String(userId),
      email: String(decoded.email),
      role: String(decoded.role),
    };

    next();
  } catch (_error) {
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

    next();
  };
};
