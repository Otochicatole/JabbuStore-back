import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

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
}
