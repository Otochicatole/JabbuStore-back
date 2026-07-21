import { Request, Response } from 'express';
import { GetStoreItemsUseCase } from '../application/GetStoreItemsUseCase';
import { PrismaStoreRepository } from './PrismaStoreRepository';
import {
  BotPriceSyncService,
  type ItemsCatalogRefreshService,
  itemsCatalogRefreshService,
} from '../../../modules/pricing';
import { BotService } from '../../marketplace/application/BotService';
import { syncExecutionCoordinator } from '../../market/application/SyncExecutionCoordinator';

const botPriceSyncService = new BotPriceSyncService();

export class StoreController {
  constructor(
    private getStoreItemsUseCase: GetStoreItemsUseCase,
    private storeRepository: PrismaStoreRepository,
    private catalogRefresh: ItemsCatalogRefreshService = itemsCatalogRefreshService,
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
    let lease: ReturnType<typeof syncExecutionCoordinator.tryAcquire> = null;
    try {
      lease = syncExecutionCoordinator.tryAcquire('bot_only');
      if (!lease) {
        const activeJob =
          syncExecutionCoordinator.getBlockingKind('bot_only') ?? 'bot_only';
        return res.status(409).json({
          started: false,
          error:
            activeJob === 'market_assets'
              ? 'Hay una sincronización de assets en curso; los bots se omiten hasta que termine.'
              : 'Ya hay una sincronización de bots en curso.',
          activeJob,
        });
      }
      console.log(
        '[StoreController] Solicitud de sync de precios de bots recibida. Ejecutando en segundo plano...',
      );

      res.status(202).json({
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
              preserveSuspiciousExistingPrice: false,
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
        } finally {
          lease?.release();
        }
      })();
    } catch (error: any) {
      lease?.release();
      console.error('[StoreController Error] Failed to sync bot prices:', error);
      res.status(500).json({ error: error.message || 'Failed to sync bot prices.' });
    }
  }

  async getPriceCatalogStatus(req: Request, res: Response) {
    try {
      const status = await this.catalogRefresh.getStatus();
      res.json(status);
    } catch (error: any) {
      console.error('[StoreController Error] Failed to get price catalog status:', error);
      res.status(500).json({ error: error.message || 'Failed to get price catalog status.' });
    }
  }

  async refreshPriceCatalog(req: Request, res: Response) {
    try {
      console.log('[StoreController] Iniciando refresh atómico de items-catalog.json.');
      const result = this.catalogRefresh.tryStart({
        triggeredBy: 'manual',
      });

      if (!result.started) {
        const message = 'Ya hay una descarga del catálogo local en curso.';
        const status = await this.catalogRefresh.getStatus();
        return res.status(409).json({
          started: false,
          error: message,
          message,
          status,
          catalog: status,
        });
      }

      const status = await this.catalogRefresh.getStatus();
      res.status(202).json({
        started: true,
        message: 'Descarga atómica de items-catalog.json iniciada en segundo plano.',
        statusUrl: '/api/store/prices/catalog/status',
        status,
        catalog: status,
      });
      void result.execution.catch((error) => {
        console.error('[StoreController] Refresh del catálogo local falló:', error);
      });
    } catch (error: any) {
      console.error('[StoreController Error] Failed to refresh price catalog:', error);
      const status = await this.catalogRefresh.getStatus().catch(() => null);
      res.status(500).json({
        error: error.message || 'Failed to refresh price catalog.',
        previousCatalog: status,
      });
    }
  }
}
