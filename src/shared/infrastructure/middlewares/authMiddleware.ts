import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../AuthService';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  let token: string | null = null;

  // 1. Intentar extraer el token desde cookies (seguro para admin)
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;)\s*admin_token\s*=\s*([^;]+)/);
    if (match && match[1]) {
      token = decodeURIComponent(match[1]);
    }
  }

  // 2. Fallback al encabezado Authorization Bearer (para APIs / usuarios)
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1] || null;
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const payload = AuthService.verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  (req as any).user = payload;
  next();
};

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ 
        error: `Access denied: One of these roles is required: ${roles.join(', ')}` 
      });
    }
    
    next();
  };
};

// Shorthands
export const adminOnly = requireRole(['ADMIN', 'SUPER_ADMIN']);
export const superAdminOnly = requireRole(['SUPER_ADMIN']);
