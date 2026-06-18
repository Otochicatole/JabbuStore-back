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
      console.log(
        '[StoreController] Solicitud de sync de precios de bots recibida. Ejecutando en segundo plano...',
      );

      res.json({
        message:
          'Sincronización de precios de bots iniciada en segundo plano. El proceso puede demorar varios minutos según el inventario y las consultas Doppler a YouPin.',
      });

      (async () => {
        try {
          await BotService.purgeStoreItemsForInactiveBots();

          const bots = await BotService.getAllBots();
          const activeSteamIds = new Set(
            bots.filter((b) => b.isActive).map((b) => b.steamId),
          );

          const items = (await this.storeRepository.findAll()).filter((item) =>
            activeSteamIds.has(item.botSteamId),
          );

          if (items.length === 0) {
            console.log(
              '[Store Sync Prices Background] No hay ítems de bots activos para actualizar.',
            );
            return;
          }

          SteamWebApiYoupinPricesClient.clearCache();
          const pricedItems =
            await PriceEnrichmentService.enrichItemsWithMarketPrices(items);
          await this.storeRepository.clearAndSaveMany(pricedItems);

          console.log(
            `[Store Sync Prices Background] Precios actualizados para ${pricedItems.length} ítems de bots activos.`,
          );
        } catch (err: any) {
          console.error(
            '[Store Sync Prices Background Error]',
            err.message || err,
          );
        }
      })();
    } catch (error: any) {
      console.error('[StoreController Error] Failed to sync bot prices:', error);
      res.status(500).json({ error: error.message || 'Failed to sync bot prices.' });
    }
  }
}
