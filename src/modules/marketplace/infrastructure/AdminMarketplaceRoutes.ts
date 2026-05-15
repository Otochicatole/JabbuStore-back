import { Router } from 'express';
import { AdminMarketplaceController } from './AdminMarketplaceController';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

// Todas las rutas de admin requieren middleware de admin
router.use(authMiddleware, adminOnly);

// Settings
router.get('/settings', AdminMarketplaceController.getSettings);
router.patch('/settings/pricing', AdminMarketplaceController.updatePricingSettings);
router.patch('/settings/minimum-sell-price', AdminMarketplaceController.updateMinimumSellPrice);

// Bots
router.get('/bots', AdminMarketplaceController.getBots);
router.post('/bots', AdminMarketplaceController.createBot);
router.patch('/bots/:id', AdminMarketplaceController.updateBot);
router.patch('/bots/:id/deactivate', AdminMarketplaceController.deactivateBot);

// Purchases
router.get('/purchases', AdminMarketplaceController.getPurchases);
router.get('/purchases/:id', AdminMarketplaceController.getPurchaseById);

// Trades
router.post('/trades/:purchaseId/process', AdminMarketplaceController.processTrade);

export default router;
