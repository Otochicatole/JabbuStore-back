import { Router } from 'express';
import { MarketplaceController } from './MarketplaceController';
import { adminOnly, authMiddleware } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

// Public settings (for clients without auth)
router.get('/settings/public', MarketplaceController.getPublicSettings);

// Listings
router.get('/listings', MarketplaceController.getActiveListings);
router.post('/listings', authMiddleware, MarketplaceController.createListing);
router.patch('/listings/:id/cancel', authMiddleware, MarketplaceController.cancelListing);

// Purchases
router.post('/purchases', authMiddleware, MarketplaceController.purchaseItem);
router.get('/user/purchases', authMiddleware, MarketplaceController.getUserPurchases);

// Confirmación manual legacy: solo admin. Los usuarios no pueden confirmar pagos desde el cliente.
router.post('/purchases/:id/confirm-payment', authMiddleware, adminOnly, MarketplaceController.confirmPayment);

export default router;
