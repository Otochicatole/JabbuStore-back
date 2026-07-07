import { Request, Response } from 'express';
import { GetMarketStoreAssetsUseCase } from '../application/GetMarketStoreAssetsUseCase';
import { SyncMarketListingsUseCase } from '../application/SyncMarketListingsUseCase';
import { GetResaleItemFloatsUseCase } from '../application/GetResaleItemFloatsUseCase';
import { SyncStoreItemsUseCase } from '../../store/application/SyncStoreItemsUseCase';
import { config } from '../../../shared/config';
import { marketSyncProgressService } from '../application/MarketSyncProgressService';

export class MarketController {
  constructor(
    private getMarketStoreAssetsUseCase: GetMarketStoreAssetsUseCase,
    private syncMarketListingsUseCase: SyncMarketListingsUseCase,
    private getResaleItemFloatsUseCase: GetResaleItemFloatsUseCase,
    private syncStoreItemsUseCase: SyncStoreItemsUseCase,
  ) {}

  /** GET /market/listings — catálogo YouPin: un ítem por FloatItem (admin y tienda pública). */
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

  /** POST /market/sync — dispara sincronización manual completa (catálogo + bots) desde el panel de admin */
  async triggerSync(_req: Request, res: Response): Promise<void> {
    try {
      if (marketSyncProgressService.getStatus().running) {
        res.status(409).json({
          error: 'Ya hay una sincronización completa en curso.',
          message: 'Ya hay una sincronización completa en curso.',
        });
        return;
      }

      console.log('[Market Controller] Solicitud de sincronización manual completa recibida. Ejecutando en segundo plano para evitar timeouts...');

      // Responder de inmediato para evitar timeout HTTP en el navegador o proxy (p. ej. Cloudflare o Nginx)
      res.json({
        message: 'Sincronización manual completa iniciada en segundo plano con éxito. El proceso demorará entre 30 y 45 segundos en actualizar el catálogo de YouPin y el stock de los bots.',
      });

      // Inicializar progreso
      const maxPages = config.marketSync.maxPages;
      marketSyncProgressService.startSync(maxPages);

      // Ejecución asíncrona en segundo plano sin bloquear la respuesta HTTP
      (async () => {
        try {
          console.log('[Market Sync Background] Iniciando actualización del catálogo...');
          const result = await this.syncMarketListingsUseCase.execute();
          console.log(`[Market Sync Background] Catálogo YouPin actualizado: ${result.floatsIndexed} floats en tienda (${result.synced} listings), ${result.skipped} omitidos en sync, ${result.assetsFetched} assets API (${result.rowsUsed} filas).`);

          console.log('[Market Sync Background] Iniciando actualización de inventario de bots...');
          marketSyncProgressService.startSyncingBots();
          await this.syncStoreItemsUseCase.execute();
          
          console.log('[Market Sync Background] Sincronización completa finalizada con éxito.');
          marketSyncProgressService.completeSync(result.synced, result.floatsIndexed);
        } catch (err: any) {
          console.error('[Market Sync Background Error] Error durante la sincronización en segundo plano:', err.message || err);
          marketSyncProgressService.failSync(err.message || String(err));
        }
      })();

    } catch (error: any) {
      console.error('[Market Controller] Error al iniciar sincronización:', error);
      res.status(500).json({ error: error.message || 'Error al iniciar la sincronización.' });
    }
  }

  /** GET /market/sync/status — devuelve el estado actual o último de la sincronización manual completa */
  async getSyncStatus(_req: Request, res: Response): Promise<void> {
    try {
      const status = marketSyncProgressService.getStatus();
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
      const floats = await this.getResaleItemFloatsUseCase.execute(id);
      res.json(floats);
    } catch (error: any) {
      console.error('[Market Controller] Error obteniendo floats:', error);
      res.status(500).json({ error: error.message || 'Error al obtener los floats del artículo.' });
    }
  }
}
