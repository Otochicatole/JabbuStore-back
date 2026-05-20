import { Router } from 'express';
import { AdminMarketplaceController } from './AdminMarketplaceController';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

// Todas las rutas de admin requieren middleware de admin
router.use(authMiddleware, adminOnly);

// Settings
router.get('/settings', AdminMarketplaceController.getSettings);
router.patch('/settings/pricing', AdminMarketplaceController.updatePricingSettings);
router.patch('/settings/user-sell', AdminMarketplaceController.updateUserSellSettings);
router.patch('/settings/minimum-sell-price', AdminMarketplaceController.updateMinimumSellPrice);
router.patch('/settings/webhook-url', AdminMarketplaceController.updateWebhookUrl);

// Bots
router.get('/bots', AdminMarketplaceController.getBots);
router.post('/bots', AdminMarketplaceController.createBot);
router.patch('/bots/:id', AdminMarketplaceController.updateBot);
router.patch('/bots/:id/deactivate', AdminMarketplaceController.deactivateBot);
router.patch('/bots/:id/activate', AdminMarketplaceController.activateBot);
router.delete('/bots/:id', AdminMarketplaceController.deleteBot);

// Purchases
router.get('/purchases', AdminMarketplaceController.getPurchases);
router.get('/purchases/:id', AdminMarketplaceController.getPurchaseById);

// User Listings (sell requests)
router.get('/listings', AdminMarketplaceController.getListings);
router.patch('/listings/:id/cancel', AdminMarketplaceController.adminCancelListing);

// Trades
router.post('/trades/:purchaseId/process', AdminMarketplaceController.processTrade);

// Store Manual Pricing Overrides
router.patch('/store/items/:assetId/price', AdminMarketplaceController.updateStoreItemPrice);

export default router;
