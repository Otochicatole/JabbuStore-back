import { Request, Response } from 'express';
import { GetStoreItemsUseCase } from '../application/GetStoreItemsUseCase';
import { PrismaStoreRepository } from './PrismaStoreRepository';
import {
  BotPriceSyncService,
  itemsCatalogRefreshService,
} from '../../../modules/pricing';
import { BotService } from '../../marketplace/application/BotService';

const botPriceSyncService = new BotPriceSyncService();

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
          'Sincronización de precios de bots iniciada en segundo plano. Fuente: catálogo local Items API (/steam/api/items).',
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

          const { items: pricedItems, catalogAvailable } =
            await botPriceSyncService.enrichItems(items, {
              forceRefreshCatalog: true,
              preserveExistingWhenMissing: true,
              useFallbackWhenMissing: false,
              logWarnings: true,
            });

          if (!catalogAvailable) {
            console.error(
              "[Store Sync Prices Background] Catálogo no disponible — precios no modificados.",
            );
            return;
          }

          const updated = await this.storeRepository.updatePricesMany(
            pricedItems.map((item) => ({
              assetId: item.assetId,
              name: item.name,
              price: item.price,
            })),
          );

          console.log(
            `[Store Sync Prices Background] Precios actualizados desde catálogo local Items API: ${updated}/${pricedItems.length} ítems.`,
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

  async getPriceCatalogStatus(req: Request, res: Response) {
    try {
      const status = await itemsCatalogRefreshService.getStatus();
      res.json(status);
    } catch (error: any) {
      console.error('[StoreController Error] Failed to get price catalog status:', error);
      res.status(500).json({ error: error.message || 'Failed to get price catalog status.' });
    }
  }

  async refreshPriceCatalog(req: Request, res: Response) {
    try {
      console.log('[StoreController] Solicitud de refresh del catálogo local Items API recibida.');
      const result = await itemsCatalogRefreshService.startRefreshInBackground({
        triggeredBy: 'manual',
      });

      if (!result.started) {
        return res.status(409).json({
          error: 'Ya hay una descarga del catálogo de precios en curso.',
          message: 'Ya hay una descarga del catálogo de precios en curso.',
          catalog: result.status,
        });
      }

      res.status(202).json({
        message: 'Descarga del catálogo de precios iniciada en segundo plano.',
        catalog: result.status,
      });
    } catch (error: any) {
      console.error('[StoreController Error] Failed to refresh price catalog:', error);
      const status = await itemsCatalogRefreshService.getStatus().catch(() => null);
      res.status(500).json({
        error: error.message || 'Failed to refresh price catalog.',
        previousCatalog: status,
      });
    }
  }
}
