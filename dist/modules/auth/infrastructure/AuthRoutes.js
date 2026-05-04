"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const passport_1 = __importDefault(require("passport"));
const AuthService_1 = require("../../../shared/infrastructure/AuthService");
const router = (0, express_1.Router)();
// Start Steam Auth
router.get('/steam', passport_1.default.authenticate('steam', { session: false }));
// Steam Callback
router.get('/steam/return', passport_1.default.authenticate('steam', { failureRedirect: '/', session: false }), (req, res) => {
    const user = req.user;
    // Generate JWT
    const token = AuthService_1.AuthService.generateToken({
        id: user.id,
        steamId: user.steamId,
        role: 'USER'
    });
    // Redirect to Frontend with token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
});
exports.default = router;
//# sourceMappingURL=AuthRoutes.js.map