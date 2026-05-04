"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const errorHandler = (err, req, res, next) => {
    const errorDetails = err.stack || err.message || JSON.stringify(err);
    console.error(`[Error] ${errorDetails}`);
    const isProduction = process.env.NODE_ENV === 'production';
    // Specific handling for known error types can be added here
    if (err.name === 'PrismaClientKnownRequestError') {
        return res.status(400).json({
            error: 'Database operation failed',
            message: isProduction ? 'A database error occurred' : err.message
        });
    }
    res.status(err.status || 500).json({
        error: err.name || 'InternalServerError',
        message: isProduction ? 'An unexpected error occurred' : err.message
    });
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=errorHandler.js.map