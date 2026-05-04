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

  // Inject user info into request (optional but useful)
  (req as any).user = payload;
  next();
};

export const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
    return res.status(403).json({ error: 'Access denied: Admin role required' });
  }
  next();
};
