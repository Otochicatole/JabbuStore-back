"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.superAdminOnly = exports.adminOnly = exports.requireRole = exports.authMiddleware = void 0;
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
    req.user = payload;
    next();
};
exports.authMiddleware = authMiddleware;
const requireRole = (roles) => {
    return (req, res, next) => {
        const user = req.user;
        if (!user || !roles.includes(user.role)) {
            return res.status(403).json({
                error: `Access denied: One of these roles is required: ${roles.join(', ')}`
            });
        }
        next();
    };
};
exports.requireRole = requireRole;
// Shorthands
exports.adminOnly = (0, exports.requireRole)(['ADMIN', 'SUPER_ADMIN']);
exports.superAdminOnly = (0, exports.requireRole)(['SUPER_ADMIN']);
//# sourceMappingURL=authMiddleware.js.map