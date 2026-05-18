import { Request, Response } from 'express';
import { AdminSettingsService } from '../application/AdminSettingsService';
import { BotService } from '../application/BotService';
import { PurchaseService } from '../application/PurchaseService';
import { TradeService } from '../application/TradeService';

export class AdminMarketplaceController {
  // Settings
  static async getSettings(req: Request, res: Response) {
    try {
      const settings = await AdminSettingsService.getSettings();
      res.json(settings);
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

  static async updateMinimumSellPrice(req: Request, res: Response) {
    try {
      const { minimumUserSellPrice } = req.body;
      const settings = await AdminSettingsService.updateMinimumSellPrice(minimumUserSellPrice);
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // Bots
  static async getBots(req: Request, res: Response) {
    try {
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
      await BotService.deleteBot(id as string);
      res.status(204).send();
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
}
