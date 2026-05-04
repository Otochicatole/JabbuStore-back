"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const zod_1 = require("zod");
const validate = (schema) => {
    return async (req, res, next) => {
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            next();
        }
        catch (error) {
            if (error instanceof zod_1.ZodError) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: error.issues.map(err => ({
                        path: err.path.join('.'),
                        message: err.message
                    }))
                });
            }
            res.status(500).json({ error: 'Internal server error during validation' });
        }
    };
};
exports.validate = validate;
//# sourceMappingURL=validationMiddleware.js.map