"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const SALT_ROUNDS = 12; // Increased rounds for better security
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables');
}
class AuthService {
    static async hashPassword(password) {
        return bcrypt_1.default.hash(password, SALT_ROUNDS);
    }
    static async comparePassword(password, hash) {
        return bcrypt_1.default.compare(password, hash);
    }
    static generateToken(payload) {
        return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    }
    static verifyToken(token) {
        try {
            return jsonwebtoken_1.default.verify(token, JWT_SECRET);
        }
        catch (error) {
            return null;
        }
    }
}
exports.AuthService = AuthService;
//# sourceMappingURL=AuthService.js.map