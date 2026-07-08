import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AdminMarketplaceController } from './AdminMarketplaceController';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();
const secretsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
});

// Todas las rutas de admin requieren middleware de admin
router.use(authMiddleware, adminOnly);

// Settings
router.get('/settings', AdminMarketplaceController.getSettings);
router.patch('/settings/pricing', AdminMarketplaceController.updatePricingSettings);
router.patch('/settings/user-sell', AdminMarketplaceController.updateUserSellSettings);
router.patch('/settings/resell', AdminMarketplaceController.updateResellSettings);
router.patch('/settings/minimum-sell-price', AdminMarketplaceController.updateMinimumSellPrice);
router.patch('/settings/webhook-url', AdminMarketplaceController.updateWebhookUrl);
router.patch('/settings/payment-methods', AdminMarketplaceController.updatePaymentMethodSettings);
router.patch('/settings/manual-transfer', AdminMarketplaceController.updateManualTransferSettings);
router.patch('/settings/home-stats', AdminMarketplaceController.updateHomeStatsSettings);
router.get('/settings/secrets/status', AdminMarketplaceController.getSecretsStatus);
router.post('/settings/secrets/:key', secretsLimiter, AdminMarketplaceController.upsertSecret);
router.post('/settings/secrets/:key/reveal', secretsLimiter, AdminMarketplaceController.revealSecret);
router.delete('/settings/secrets/:key', secretsLimiter, AdminMarketplaceController.deleteSecret);
router.get('/settings/runtime-config', AdminMarketplaceController.getRuntimeSettings);
router.patch('/settings/runtime-config', AdminMarketplaceController.updateRuntimeSettings);

// Bots
router.get('/bots', AdminMarketplaceController.getBots);
router.post('/bots/sync', AdminMarketplaceController.syncBotsInventory);
router.get('/bots/sync/status', AdminMarketplaceController.getSyncBotsInventoryStatus);
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
router.patch('/store/items/:assetId/marketable', AdminMarketplaceController.updateStoreItemMarketable);

// Skin details lookup by assetId for historical items
router.get('/items/details/:assetId', AdminMarketplaceController.getItemDetailsByAssetId);

export default router;
