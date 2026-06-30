import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const SALT_ROUNDS = 12; // Increased rounds for better security
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not defined in environment variables');
}

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  static generateToken(payload: any): string {
    return jwt.sign(payload, JWT_SECRET!, { expiresIn: '24h' });
  }

  static verifyToken(token: string): any {
    try {
      return jwt.verify(token, JWT_SECRET!);
    } catch (error) {
      return null;
    }
  }

  static generateSocketToken(payload: { id: string; role: string }): string {
    return jwt.sign(
      { sub: payload.id, role: payload.role, purpose: 'ticket_socket' },
      JWT_SECRET!,
      { expiresIn: '2m', audience: 'ticket-socket' },
    );
  }

  static verifySocketToken(token: string): { id: string; role: string } | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET!, {
        audience: 'ticket-socket',
      }) as JwtPayload;
      if (
        payload.purpose !== 'ticket_socket' ||
        typeof payload.sub !== 'string' ||
        typeof payload.role !== 'string'
      ) {
        return null;
      }
      return { id: payload.sub, role: payload.role };
    } catch {
      return null;
    }
  }
}
