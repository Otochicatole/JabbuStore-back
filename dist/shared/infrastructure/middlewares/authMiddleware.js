"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminOnly = exports.authMiddleware = void 0;
const AuthService_1 = require("../AuthService");
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization token required' });
    }
    const token = authHeader.split(' ')[1];
    const payload = AuthService_1.AuthService.verifyToken(token);
    if (!payload) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    // Inject user info into request (optional but useful)
    req.user = payload;
    next();
};
exports.authMiddleware = authMiddleware;
const adminOnly = (req, res, next) => {
    const user = req.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
        return res.status(403).json({ error: 'Access denied: Admin role required' });
    }
    next();
};
exports.adminOnly = adminOnly;
//# sourceMappingURL=authMiddleware.js.map