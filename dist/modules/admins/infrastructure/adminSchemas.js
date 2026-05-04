"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginAdminSchema = exports.createAdminSchema = void 0;
const zod_1 = require("zod");
exports.createAdminSchema = zod_1.z.object({
    body: zod_1.z.object({
        username: zod_1.z.string().min(3).max(30),
        email: zod_1.z.string().email(),
        password: zod_1.z.string()
            .min(8, 'Password must be at least 8 characters')
            .max(100)
            .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
            .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
            .regex(/[0-9]/, 'Password must contain at least one number'),
        role: zod_1.z.enum(['ADMIN', 'SUPER_ADMIN']).optional(),
    }),
});
exports.loginAdminSchema = zod_1.z.object({
    body: zod_1.z.object({
        email: zod_1.z.string().email(),
        password: zod_1.z.string().min(1),
    }),
});
//# sourceMappingURL=adminSchemas.js.map