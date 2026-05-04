"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginAdminSchema = exports.createAdminSchema = void 0;
const zod_1 = require("zod");
exports.createAdminSchema = zod_1.z.object({
    body: zod_1.z.object({
        username: zod_1.z.string().min(3).max(30),
        email: zod_1.z.string().email(),
        password: zod_1.z.string().min(8).max(100),
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