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
router.patch('/settings/resell', AdminMarketplaceController.updateResellSettings);
router.patch('/settings/minimum-sell-price', AdminMarketplaceController.updateMinimumSellPrice);
router.patch('/settings/webhook-url', AdminMarketplaceController.updateWebhookUrl);
router.patch('/settings/payment-methods', AdminMarketplaceController.updatePaymentMethodSettings);
router.patch('/settings/manual-transfer', AdminMarketplaceController.updateManualTransferSettings);
router.get('/settings/secrets/status', AdminMarketplaceController.getSecretsStatus);
router.post('/settings/secrets/:key', AdminMarketplaceController.upsertSecret);
router.post('/settings/secrets/:key/reveal', AdminMarketplaceController.revealSecret);
router.delete('/settings/secrets/:key', AdminMarketplaceController.deleteSecret);
router.get('/settings/runtime-config', AdminMarketplaceController.getRuntimeSettings);
router.patch('/settings/runtime-config', AdminMarketplaceController.updateRuntimeSettings);

// Bots
router.get('/bots', AdminMarketplaceController.getBots);
router.post('/bots/sync', AdminMarketplaceController.syncBotsInventory);
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

// Skin details lookup by assetId for historical items
router.get('/items/details/:assetId', AdminMarketplaceController.getItemDetailsByAssetId);

export default router;
