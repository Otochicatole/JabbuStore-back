import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam';
import { PrismaUserRepository } from '../../users/infrastructure/PrismaUserRepository';
import { AuthService } from '../../../shared/infrastructure/AuthService';

const userRepository = new PrismaUserRepository();

export const configurePassport = () => {
  passport.use(
    new SteamStrategy(
      {
        returnURL: `${process.env.BACKEND_URL}/api/auth/steam/return`,
        realm: `${process.env.BACKEND_URL}/`,
        apiKey: process.env.STEAM_API_KEY!,
      },
      async (identifier: string, profile: any, done: any) => {
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
          } else {
            // Update profile info
            user = await userRepository.save({
              id: user.id,
              name: profile.displayName,
              avatar: profile.photos && profile.photos.length > 0 ? profile.photos[profile.photos.length - 1].value : null,
              profileUrl: profile._json.profileurl,
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );

  // Passport needs these even if we use JWT
  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((obj: any, done) => {
    done(null, obj);
  });
};
