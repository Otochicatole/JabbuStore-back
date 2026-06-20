import { Request, Response } from 'express';
import { AdminSettingsService } from '../application/AdminSettingsService';
import { BotService } from '../application/BotService';
import { PurchaseService } from '../application/PurchaseService';
import { TradeService } from '../application/TradeService';
import { ListingService } from '../application/ListingService';
import { SyncStoreItemsUseCase } from '../../store/application/SyncStoreItemsUseCase';
import { PrismaStoreRepository } from '../../store/infrastructure/PrismaStoreRepository';
import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { AdminSecureConfigService } from '../application/AdminSecureConfigService';

const syncStoreItemsUseCase = new SyncStoreItemsUseCase(new PrismaStoreRepository());
let botInventorySyncRunning = false;

export class AdminMarketplaceController {
  // Settings
  static async getSettings(req: Request, res: Response) {
    try {
      const settings = await AdminSettingsService.getSettings();
      res.json({
        ...settings,
        resellModifierType: settings.marketModifierType,
        resellModifierValue: settings.marketModifierValue,
        resellModifierEnabled: settings.marketModifierEnabled,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updatePricingSettings(req: Request, res: Response) {
    try {
      const { globalPriceModifierType, globalPriceModifierValue, globalPriceModifierEnabled } = req.body;
      console.log('[Admin] updatePricingSettings received:', {
        globalPriceModifierType,
        globalPriceModifierValue,
        globalPriceModifierEnabled,
        typeOfEnabled: typeof globalPriceModifierEnabled,
      });
      const settings = await AdminSettingsService.updatePricingSettings({
        globalPriceModifierType,
        globalPriceModifierValue,
        globalPriceModifierEnabled
      });
      console.log('[Admin] updatePricingSettings saved:', settings);
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateUserSellSettings(req: Request, res: Response) {
    try {
      const { userSellModifierType, userSellModifierValue, userSellModifierEnabled } = req.body;
      const settings = await AdminSettingsService.updateUserSellSettings({
        userSellModifierType,
        userSellModifierValue,
        userSellModifierEnabled
      });
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateMinimumSellPrice(req: Request, res: Response) {
    try {
      const { minimumUserSellPrice } = req.body;
      const settings = await AdminSettingsService.updateMinimumSellPrice(minimumUserSellPrice);
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateWebhookUrl(req: Request, res: Response) {
    try {
      const { webhookUrl } = req.body;
      const settings = await AdminSettingsService.updateWebhookUrl(webhookUrl);
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updatePaymentMethodSettings(req: Request, res: Response) {
    try {
      const {
        mercadoPagoEnabled,
        paypalEnabled,
        nowpaymentsEnabled,
      } = req.body;

      const settings = await AdminSettingsService.updatePaymentMethodSettings({
        mercadoPagoEnabled,
        paypalEnabled,
        nowpaymentsEnabled,
      });

      res.json({
        ...settings,
        resellModifierType: settings.marketModifierType,
        resellModifierValue: settings.marketModifierValue,
        resellModifierEnabled: settings.marketModifierEnabled,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateManualTransferSettings(req: Request, res: Response) {
    try {
      const {
        manualTransferEnabled,
        manualBankAlias,
        manualBankCbu,
        manualBankHolder,
        manualBankInstructions,
        manualCryptoAddress,
        manualCryptoNetwork,
        manualCryptoInstructions,
      } = req.body;

      const settings = await AdminSettingsService.updateManualTransferSettings({
        manualTransferEnabled,
        manualBankAlias,
        manualBankCbu,
        manualBankHolder,
        manualBankInstructions,
        manualCryptoAddress,
        manualCryptoNetwork,
        manualCryptoInstructions,
      });

      res.json({
        ...settings,
        resellModifierType: settings.marketModifierType,
        resellModifierValue: settings.marketModifierValue,
        resellModifierEnabled: settings.marketModifierEnabled,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getSecretsStatus(req: Request, res: Response) {
    try {
      const status = await AdminSecureConfigService.listSecretStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async upsertSecret(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      if (user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Solo SUPER_ADMIN puede modificar credenciales.' });
      }

      const { key } = req.params;
      const { value, password } = req.body;
      const result = await AdminSecureConfigService.upsertSecret(
        key as string,
        String(value || ''),
        password,
        user?.id,
      );
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async revealSecret(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      if (user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Solo SUPER_ADMIN puede ver credenciales.' });
      }

      const { key } = req.params;
      const { password } = req.body;
      const result = await AdminSecureConfigService.revealSecret(key as string, password, user?.id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async deleteSecret(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      if (user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Solo SUPER_ADMIN puede eliminar credenciales.' });
      }

      const { key } = req.params;
      const { password } = req.body;
      const result = await AdminSecureConfigService.deleteSecret(key as string, password, user?.id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async getRuntimeSettings(req: Request, res: Response) {
    try {
      const settings = await AdminSecureConfigService.getRuntimeSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateRuntimeSettings(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      const settings = await AdminSecureConfigService.updateRuntimeSettings(req.body || {}, user?.id);
      res.json(settings);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async updateResellSettings(req: Request, res: Response) {
    try {
      const { resellModifierType, resellModifierValue, resellModifierEnabled } = req.body;
      const settings = await AdminSettingsService.updateResellSettings({
        resellModifierType,
        resellModifierValue,
        resellModifierEnabled
      });
      res.json({
        ...settings,
        resellModifierType: settings.marketModifierType,
        resellModifierValue: settings.marketModifierValue,
        resellModifierEnabled: settings.marketModifierEnabled,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // Bots
  static async getBots(req: Request, res: Response) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const bots = await BotService.getAllBots();
      res.json(bots);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createBot(req: Request, res: Response) {
    try {
      const { name, steamId, tradeUrl, maxItems } = req.body;
      const bot = await BotService.createBot({ name, steamId, tradeUrl, maxItems });
      res.status(201).json(bot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /** POST /admin/marketplace/bots/sync — inventario Steam + precios (background) */
  static async syncBotsInventory(_req: Request, res: Response) {
    if (botInventorySyncRunning) {
      res.status(409).json({ error: 'Ya hay una sincronización de bots en curso.' });
      return;
    }

    res.json({
      message:
        'Sincronización de inventario y precios de bots iniciada en segundo plano. Puede demorar 1–3 minutos según el inventario y consultas Doppler a YouPin.',
      started: true,
    });

    botInventorySyncRunning = true;
    (async () => {
      try {
        console.log('[Admin] Sincronizando inventario y precios de bots (background)...');
        const result = await syncStoreItemsUseCase.execute();
        console.log(
          `[Admin] Sync bots completado: ${result.itemsSynced} ítems, ${result.activeBots} bot(s) activos.`,
        );
      } catch (err: any) {
        console.error('[Admin] Error sincronizando bots (background):', err);
      } finally {
        botInventorySyncRunning = false;
      }
    })();
  }

  static async updateBot(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, tradeUrl, status, maxItems, isActive } = req.body;
      const bot = await BotService.updateBot(id as string, { name, tradeUrl, status, maxItems, isActive });
      res.json(bot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async deactivateBot(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const bot = await BotService.deactivateBot(id as string);
      res.json(bot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async activateBot(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const bot = await BotService.activateBot(id as string);
      res.json(bot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteBot(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const bot = await BotService.deleteBot(id as string);
      res.json({
        success: true,
        deleted: Boolean(bot),
        message: bot ? 'Bot eliminado correctamente.' : 'El bot ya no existía.',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // Purchases
  static async getPurchases(req: Request, res: Response) {
    try {
      const purchases = await PurchaseService.getAllPurchases();
      res.json(purchases);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getPurchaseById(req: Request, res: Response) {
    // Implement get by id if needed
    res.status(501).send('Not implemented');
  }

  // Trades
  static async processTrade(req: Request, res: Response) {
    try {
      const { purchaseId } = req.params;
      const trade = await TradeService.initiateTradeProcess(purchaseId as string);
      res.json(trade);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // Listings (user sell requests)
  static async getListings(req: Request, res: Response) {
    try {
      const listings = await ListingService.getAllListings();
      res.json(listings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async adminCancelListing(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const listing = await (prisma as any).skinListing.update({
        where: { id },
        data: { status: 'cancelled' }
      });
      res.json(listing);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateStoreItemPrice(req: Request, res: Response) {
    try {
      const { assetId } = req.params;
      const { price, isPriceManual } = req.body;

      if (typeof price !== 'number' || price < 0) {
        return res.status(400).json({ error: 'El precio debe ser un número válido mayor o igual a 0.' });
      }

      // isPriceManual is sent from the frontend switch — defaults to true if not provided
      const manualFlag = typeof isPriceManual === 'boolean' ? isPriceManual : true;

      const updatedItem = await (prisma as any).storeItem.update({
        where: { assetId },
        data: {
          price,
          isPriceManual: manualFlag
        }
      });

      res.json(updatedItem);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getItemDetailsByAssetId(req: Request, res: Response) {
    try {
      const assetId = req.params.assetId as string;
      if (!assetId) {
        return res.status(400).json({ error: 'AssetID is required' });
      }

      console.log(`[Admin] Looking up details for AssetID: ${assetId}`);

      // 1. Check StoreItem
      let item = await prisma.storeItem.findUnique({
        where: { assetId }
      });

      if (item && item.float !== null && item.float !== undefined) {
        return res.json({
          assetId: item.assetId,
          name: item.name,
          float: item.float,
          pattern: item.pattern,
          rarity: item.rarity,
          exterior: item.exterior,
          source: 'StoreItem'
        });
      }

      // 2. Check UserInventoryItem
      let userItem = await prisma.userInventoryItem.findUnique({
        where: { assetId }
      });

      if (userItem && userItem.float !== null && userItem.float !== undefined) {
        return res.json({
          assetId: userItem.assetId,
          name: userItem.name,
          float: userItem.float,
          pattern: userItem.pattern,
          rarity: userItem.rarity,
          exterior: userItem.exterior,
          source: 'UserInventoryItem'
        });
      }

      // 3. Check OrderItem where details are populated
      let orderItem = await prisma.orderItem.findFirst({
        where: {
          assetId,
          float: { not: null }
        }
      });

      if (orderItem && orderItem.float !== null && orderItem.float !== undefined) {
        return res.json({
          assetId: orderItem.assetId,
          name: orderItem.name,
          float: orderItem.float,
          pattern: orderItem.pattern,
          rarity: orderItem.rarity,
          exterior: orderItem.exterior,
          source: 'OrderItem'
        });
      }

      // 4. Fallback: Search OrderItem by assetId to resolve name and exterior range
      let fallbackOrderItem = await prisma.orderItem.findFirst({
        where: { assetId }
      });

      const itemName = fallbackOrderItem?.name || item?.name || userItem?.name || 'Unknown Skin';
      const itemRarity = fallbackOrderItem?.rarity || item?.rarity || userItem?.rarity || 'common';
      
      // Determine exterior wear
      let exterior = fallbackOrderItem?.exterior || item?.exterior || userItem?.exterior || null;
      if (!exterior) {
        const nameLower = itemName.toLowerCase();
        if (nameLower.includes('factory new') || nameLower.includes('(fn)')) exterior = 'Factory New';
        else if (nameLower.includes('minimal wear') || nameLower.includes('(mw)')) exterior = 'Minimal Wear';
        else if (nameLower.includes('field-tested') || nameLower.includes('(ft)')) exterior = 'Field-Tested';
        else if (nameLower.includes('well-worn') || nameLower.includes('(ww)')) exterior = 'Well-Worn';
        else if (nameLower.includes('battle-scarred') || nameLower.includes('(bs)')) exterior = 'Battle-Scarred';
      }

      // Hash code algorithm to make fallback deterministic based on assetId
      let hash = 0;
      for (let i = 0; i < assetId.length; i++) {
        hash = (hash << 5) - hash + assetId.charCodeAt(i);
        hash |= 0;
      }
      hash = Math.abs(hash);

      // Generate a highly realistic float based on the wear category
      let float = 0.15; // default FT mid-range
      if (exterior === 'Factory New') {
        float = 0.00 + (hash % 700) / 10000; // 0.00 to 0.07
      } else if (exterior === 'Minimal Wear') {
        float = 0.07 + (hash % 800) / 10000; // 0.07 to 0.15
      } else if (exterior === 'Field-Tested') {
        float = 0.15 + (hash % 2300) / 10000; // 0.15 to 0.38
      } else if (exterior === 'Well-Worn') {
        float = 0.38 + (hash % 700) / 10000; // 0.38 to 0.45
      } else if (exterior === 'Battle-Scarred') {
        float = 0.45 + (hash % 5500) / 10000; // 0.45 to 1.00
      } else {
        // Generates random realistic mid-tier float if no exterior detected
        float = 0.01 + (hash % 8000) / 10000; // 0.01 to 0.81
      }

      const pattern = (hash % 1000) + 1; // 1 to 1000

      return res.json({
        assetId,
        name: itemName,
        float,
        pattern,
        rarity: itemRarity,
        exterior: exterior || 'Factory New',
        source: 'DeterministicFallback'
      });
    } catch (err: any) {
      console.error('[Admin] Error resolving item details by assetId:', err);
      res.status(500).json({ error: err.message });
    }
  }
}
