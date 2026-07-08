import { Router } from 'express';
import passport from 'passport';
import crypto from 'node:crypto';
import { AuthService } from '../../../shared/infrastructure/AuthService';

const router = Router();
const STEAM_SESSION_CODE_TTL_MS = 2 * 60 * 1000;
const pendingSteamSessions = new Map<string, { token: string; expiresAt: number }>();

function issueSteamSessionCode(token: string) {
  const code = crypto.randomBytes(32).toString('base64url');
  pendingSteamSessions.set(code, {
    token,
    expiresAt: Date.now() + STEAM_SESSION_CODE_TTL_MS,
  });
  return code;
}

function consumeSteamSessionCode(code: string) {
  const pending = pendingSteamSessions.get(code);
  pendingSteamSessions.delete(code);

  if (!pending || pending.expiresAt < Date.now()) {
    return null;
  }

  return pending.token;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, pending] of pendingSteamSessions.entries()) {
    if (pending.expiresAt < now) {
      pendingSteamSessions.delete(code);
    }
  }
}, STEAM_SESSION_CODE_TTL_MS).unref();

// Start Steam Auth
router.get('/steam', passport.authenticate('steam', { session: false }));

// Steam Callback
router.get(
  '/steam/return',
  passport.authenticate('steam', { failureRedirect: '/', session: false }),
  (req, res) => {
    const user = req.user as any;
    
    // Generate JWT
    const token = AuthService.generateToken({ 
      id: user.id, 
      steamId: user.steamId, 
      role: 'USER' 
    });

    // Redirect to Frontend BFF with a short-lived one-time code.
    // The JWT itself never appears in browser URLs or frontend logs.
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const code = issueSteamSessionCode(token);
    res.redirect(`${frontendUrl}/api/auth/session?code=${encodeURIComponent(code)}`);
  }
);

router.post('/steam/session', (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const token = code ? consumeSteamSessionCode(code) : null;

  if (!token) {
    return res.status(401).json({ error: 'Invalid or expired Steam session code' });
  }

  return res.json({ token });
});

export default router;
