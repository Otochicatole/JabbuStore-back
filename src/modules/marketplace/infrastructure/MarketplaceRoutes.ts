import { Router } from 'express';
import { MarketplaceController } from './MarketplaceController';
import { authMiddleware } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

// Listings
router.get('/listings', MarketplaceController.getActiveListings);
router.post('/listings', authMiddleware, MarketplaceController.createListing);
router.patch('/listings/:id/cancel', authMiddleware, MarketplaceController.cancelListing);

// Purchases
router.post('/purchases', authMiddleware, MarketplaceController.purchaseItem);
router.get('/user/purchases', authMiddleware, MarketplaceController.getUserPurchases);

// Confirmación de pago (solo para demo o si el cliente lo confirma por ahora, 
// en prod debería ser un webhook seguro)
router.post('/purchases/:id/confirm-payment', MarketplaceController.confirmPayment);

export default router;
