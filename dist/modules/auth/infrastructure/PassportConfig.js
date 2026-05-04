"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configurePassport = void 0;
const passport_1 = __importDefault(require("passport"));
const passport_steam_1 = require("passport-steam");
const PrismaUserRepository_1 = require("../../users/infrastructure/PrismaUserRepository");
const userRepository = new PrismaUserRepository_1.PrismaUserRepository();
const configurePassport = () => {
    passport_1.default.use(new passport_steam_1.Strategy({
        returnURL: `${process.env.BACKEND_URL}/api/auth/steam/return`,
        realm: `${process.env.BACKEND_URL}/`,
        apiKey: process.env.STEAM_API_KEY,
    }, async (identifier, profile, done) => {
        try {
            const steamId = profile.id;
            let user = await userRepository.findBySteamId(steamId);
            if (!user) {
                user = await userRepository.save({
                    steamId,
                    name: profile.displayName,
                    avatar: profile.photos && profile.photos.length > 0 ? profile.photos[profile.photos.length - 1].value : null,
                    profileUrl: profile._json.profileurl,
                });
            }
            else {
                // Update profile info
                user = await userRepository.save({
                    id: user.id,
                    name: profile.displayName,
                    avatar: profile.photos && profile.photos.length > 0 ? profile.photos[profile.photos.length - 1].value : null,
                    profileUrl: profile._json.profileurl,
                });
            }
            return done(null, user);
        }
        catch (error) {
            return done(error, null);
        }
    }));
    // Passport needs these even if we use JWT
    passport_1.default.serializeUser((user, done) => {
        done(null, user);
    });
    passport_1.default.deserializeUser((obj, done) => {
        done(null, obj);
    });
};
exports.configurePassport = configurePassport;
//# sourceMappingURL=PassportConfig.js.map