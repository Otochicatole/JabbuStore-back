import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../AuthService';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const token = authHeader.split(' ')[1];
  const payload = AuthService.verifyToken(token!);

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
