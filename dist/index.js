"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = require("express-rate-limit");
const UserRoutes_1 = __importDefault(require("./modules/users/infrastructure/UserRoutes"));
const AdminRoutes_1 = __importDefault(require("./modules/admins/infrastructure/AdminRoutes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
const limiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again after 15 minutes',
});
app.use((0, helmet_1.default)());
app.use(limiter);
app.use((0, cors_1.default)());
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json());
// Routes
app.use('/api/users', UserRoutes_1.default);
app.use('/api/admins', AdminRoutes_1.default);
const errorHandler_1 = require("./shared/infrastructure/middlewares/errorHandler");
app.use(errorHandler_1.errorHandler);
app.get('/', (req, res) => {
    res.json({
        message: 'Server is running',
        architecture: 'Clean + Screaming',
        modules: ['users', 'admins']
    });
});
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map