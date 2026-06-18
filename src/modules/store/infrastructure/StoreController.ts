import { Request, Response } from 'express';
import { GetStoreItemsUseCase } from '../application/GetStoreItemsUseCase';
import { PrismaStoreRepository } from './PrismaStoreRepository';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';
import { SteamWebApiYoupinPricesClient } from '../../../shared/infrastructure/SteamWebApiYoupinPricesClient';
import { BotService } from '../../marketplace/application/BotService';

export class StoreController {
  constructor(
    private getStoreItemsUseCase: GetStoreItemsUseCase,
    private storeRepository: PrismaStoreRepository,
  ) {}

  async getItems(req: Request, res: Response) {
    try {
      const items = await this.getStoreItemsUseCase.execute();
      res.json(items);
    } catch (error: any) {
      console.error('[StoreController Error] Failed to get items:', error);
      res.status(500).json({ error: error.message || 'Failed to retrieve store items' });
    }
  }

  async syncPrices(req: Request, res: Response) {
    try {
      console.log('[StoreController] Sincronizando precios de bots con YouPin (/market/youpin/prices)...');

      await BotService.purgeStoreItemsForInactiveBots();

      const bots = await BotService.getAllBots();
      const activeSteamIds = new Set(
        bots.filter((b) => b.isActive).map((b) => b.steamId),
      );

      const items = (await this.storeRepository.findAll()).filter((item) =>
        activeSteamIds.has(item.botSteamId),
      );

      if (items.length === 0) {
        res.json({
          message: 'No hay ítems de bots activos para actualizar precios.',
          updated: 0,
        });
        return;
      }

      SteamWebApiYoupinPricesClient.clearCache();
      const pricedItems = await PriceEnrichmentService.enrichItemsWithMarketPrices(items);
      await this.storeRepository.clearAndSaveMany(pricedItems);

      res.json({
        message: `Precios actualizados para ${pricedItems.length} ítems de bots activos vía YouPin prices API.`,
        updated: pricedItems.length,
      });
    } catch (error: any) {
      console.error('[StoreController Error] Failed to sync bot prices:', error);
      res.status(500).json({ error: error.message || 'Failed to sync bot prices.' });
    }
  }
}
