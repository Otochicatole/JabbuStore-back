import { Request, Response } from 'express';
import { GetMarketStoreAssetsUseCase } from '../application/GetMarketStoreAssetsUseCase';
import { GetOrRefreshListingFloatsUseCase } from '../application/GetOrRefreshListingFloatsUseCase';
import { RunFullCatalogSyncUseCase } from '../application/RunFullCatalogSyncUseCase';
import { GetMarketSyncStatusUseCase } from '../application/GetMarketSyncStatusUseCase';
import { itemsCatalogRefreshService } from '../../pricing/application/ItemsCatalogRefreshService';
import { DownloadYoupinPricesUseCase } from '../application/DownloadYoupinPricesUseCase';
import { GenerateCatalogGlobalUseCase } from '../application/GenerateCatalogGlobalUseCase';
import { SyncCatalogGlobalToDbUseCase } from '../application/SyncCatalogGlobalToDbUseCase';
import { PrismaMarketRepository } from './PrismaMarketRepository';

export class MarketController {
  private downloadYoupinPricesUseCase = new DownloadYoupinPricesUseCase();
  private generateCatalogGlobalUseCase = new GenerateCatalogGlobalUseCase();
  private syncCatalogGlobalToDbUseCase: SyncCatalogGlobalToDbUseCase;

  constructor(
    private getMarketStoreAssetsUseCase: GetMarketStoreAssetsUseCase,
    private runFullCatalogSyncUseCase: RunFullCatalogSyncUseCase,
    private getMarketSyncStatusUseCase: GetMarketSyncStatusUseCase,
    private getOrRefreshListingFloatsUseCase: GetOrRefreshListingFloatsUseCase,
    private marketRepository = new PrismaMarketRepository(),
  ) {
    this.syncCatalogGlobalToDbUseCase = new SyncCatalogGlobalToDbUseCase(this.marketRepository);
  }

  /** GET /market/listings — catálogo YouPin. */
  async getListings(_req: Request, res: Response): Promise<void> {
    try {
      const assets = await this.getMarketStoreAssetsUseCase.execute();
      res.json(
        assets.map((asset) => ({
          ...asset,
          float: asset.floatValue,
          pattern: asset.paintSeed,
        })),
      );
    } catch (error) {
      console.error('[Market Controller] Error obteniendo listings:', error);
      res.status(500).json({ error: 'Error al obtener el catálogo de mercado.' });
    }
  }

  /** POST /market/download-items-catalog — Paso 1: Descargar items-catalog.json */
  async downloadItemsCatalog(_req: Request, res: Response): Promise<void> {
    try {
      console.log('[Market Controller] Iniciando Paso 1: Descargar items-catalog.json...');
      const status = await itemsCatalogRefreshService.refreshNow({ triggeredBy: 'admin' });
      res.json({
        success: true,
        message: 'items-catalog.json descargado correctamente.',
        fetchedAt: status.fetchedAt,
        itemCount: status.lastItemCount,
      });
    } catch (error: any) {
      console.error('[Market Controller] Error en Paso 1:', error);
      res.status(500).json({ error: error.message || 'Error al descargar items-catalog.json' });
    }
  }

  /** POST /market/download-youpin-prices — Paso 2: Descargar youpin-prices.json */
  async downloadYoupinPrices(_req: Request, res: Response): Promise<void> {
    try {
      console.log('[Market Controller] Iniciando Paso 2: Descargar youpin-prices.json...');
      const result = await this.downloadYoupinPricesUseCase.execute();
      res.json({
        success: true,
        message: 'youpin-prices.json descargado correctamente.',
        ...result,
      });
    } catch (error: any) {
      console.error('[Market Controller] Error en Paso 2:', error);
      res.status(500).json({ error: error.message || 'Error al descargar youpin-prices.json' });
    }
  }

  /** POST /market/generate-catalog-global — Paso 3: Generar catalog-global.json */
  async generateCatalogGlobal(_req: Request, res: Response): Promise<void> {
    try {
      console.log('[Market Controller] Iniciando Paso 3: Generar catalog-global.json...');
      const result = await this.generateCatalogGlobalUseCase.execute();
      res.json({
        success: true,
        message: 'catalog-global.json generado correctamente.',
        ...result,
      });
    } catch (error: any) {
      console.error('[Market Controller] Error en Paso 3:', error);
      res.status(500).json({ error: error.message || 'Error al generar catalog-global.json' });
    }
  }

  /** POST /market/sync-catalog-global-db — Paso 4: Sincronizar catalog-global.json a BD */
  async syncCatalogGlobalDb(_req: Request, res: Response): Promise<void> {
    try {
      console.log('[Market Controller] Iniciando Paso 4: Sincronizar catalog-global.json a BD...');
      const result = await this.syncCatalogGlobalToDbUseCase.execute();
      res.json({
        success: true,
        message: 'catalog-global.json sincronizado a base de datos correctamente.',
        ...result,
      });
    } catch (error: any) {
      console.error('[Market Controller] Error en Paso 4:', error);
      res.status(500).json({ error: error.message || 'Error al sincronizar a BD' });
    }
  }

  /** POST /market/sync — Sincronización Completa (Pasos 1 a 4). */
  async triggerSync(_req: Request, res: Response): Promise<void> {
    try {
      const started = this.runFullCatalogSyncUseCase.tryStart('manual');
      if (!started.started) {
        const blockedByBots = started.blockingReason === 'bot_only';
        const message = blockedByBots
          ? 'Hay una sincronización de bots en curso.'
          : 'Ya hay una sincronización de assets en curso.';
        res.status(409).json({
          started: false,
          error: message,
          message,
          blockingJob: started.blockingReason,
          ...(blockedByBots
            ? {}
            : { status: await this.getMarketSyncStatusUseCase.execute() }),
        });
        return;
      }

      res.status(202).json({
        started: true,
        message: 'Sincronización completa de YouPin iniciada en segundo plano.',
        statusUrl: '/api/market/sync/status',
      });

      void started.execution.then(
        (result) => {
          console.log(
            `[Market Assets Background] Sincronización global YouPin completada: ${result.matched} listings.`,
          );
        },
        (error) => {
          console.error('[Market Assets Background] Error:', error);
        },
      );

    } catch (error: any) {
      console.error('[Market Controller] Error al iniciar sincronización:', error);
      res.status(500).json({ error: error.message || 'Error al iniciar la sincronización.' });
    }
  }

  /** GET /market/sync/status — devuelve exclusivamente el estado del job de assets. */
  async getSyncStatus(_req: Request, res: Response): Promise<void> {
    try {
      const status = await this.getMarketSyncStatusUseCase.execute();
      res.json(status);
    } catch (error: any) {
      console.error('[Market Controller] Error obteniendo status de sync:', error);
      res.status(500).json({ error: error.message || 'Error al obtener el estado de sincronización.' });
    }
  }

  /** GET /market/listings/:id/floats — devuelve floats para un resale item con displayPrice */
  async getFloats(req: Request, res: Response): Promise<void> {
    try {
      const id = decodeURIComponent(req.params.id as string);
      if (!id) {
        res.status(400).json({ error: 'Falta el ID del artículo de reventa.' });
        return;
      }
      
      const options = {
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
        sortBy: (req.query.sortBy as 'float_asc' | 'float_desc' | 'price_asc' | 'price_desc') || 'float_asc',
        forceRefresh: req.query.forceRefresh === 'true',
      };
      
      const result = await this.getOrRefreshListingFloatsUseCase.execute(id, options);
      res.json(result.floats);
    } catch (error: any) {
      console.error('[Market Controller] Error obteniendo floats:', error);
      res.status(500).json({ error: error.message || 'Error al obtener los floats del artículo.' });
    }
  }
}
