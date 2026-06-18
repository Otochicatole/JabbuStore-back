import { Request, Response } from 'express';
import { GetStoreItemsUseCase } from '../application/GetStoreItemsUseCase';
import { PrismaStoreRepository } from './PrismaStoreRepository';
import {
  BotPriceSyncService,
  SteamWebApiItemsCatalogClient,
  SteamWebApiItemsCatalogStore,
} from '../../../modules/pricing';
import { BotService } from '../../marketplace/application/BotService';

const botPriceSyncService = new BotPriceSyncService();
const itemsCatalogClient = new SteamWebApiItemsCatalogClient();
const itemsCatalogStore = new SteamWebApiItemsCatalogStore();

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
      const status = await itemsCatalogStore.getStatus();
      res.json(status);
    } catch (error: any) {
      console.error('[StoreController Error] Failed to get price catalog status:', error);
      res.status(500).json({ error: error.message || 'Failed to get price catalog status.' });
    }
  }

  async refreshPriceCatalog(req: Request, res: Response) {
    try {
      console.log('[StoreController] Actualizando catálogo local Items API...');
      const result = await itemsCatalogClient.fetchCatalog({ forceRefresh: true });

      if (!result.snapshot) {
        const status = await itemsCatalogStore.getStatus();
        return res.status(502).json({
          error: 'No se pudo actualizar el catálogo local Items API.',
          status: result.status,
          errors: result.errors,
          previousCatalog: status,
        });
      }

      await itemsCatalogStore.writeCatalog(result.snapshot);
      const status = await itemsCatalogStore.getStatus();

      res.json({
        message: `Catálogo de precios actualizado: ${result.snapshot.itemCount} items en ${result.snapshot.pageCount} páginas.`,
        ok: result.ok,
        status: result.status,
        errors: result.errors,
        catalog: status,
      });
    } catch (error: any) {
      console.error('[StoreController Error] Failed to refresh price catalog:', error);
      const status = await itemsCatalogStore.getStatus().catch(() => null);
      res.status(500).json({
        error: error.message || 'Failed to refresh price catalog.',
        previousCatalog: status,
      });
    }
  }
}
