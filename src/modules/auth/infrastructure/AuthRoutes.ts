import { Router } from 'express';
import passport from 'passport';
import { AuthService } from '../../../shared/infrastructure/AuthService';

const router = Router();

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

    // Redirect to Frontend BFF directly to set cookie
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/api/auth/session?token=${token}`);
  }
);

export default router;
