import { Request, Response } from 'express';
import { GetMarketListingsUseCase } from '../application/GetMarketListingsUseCase';
import { GetMarketStoreAssetsUseCase } from '../application/GetMarketStoreAssetsUseCase';
import { SyncMarketListingsUseCase } from '../application/SyncMarketListingsUseCase';
import { GetResaleItemFloatsUseCase } from '../application/GetResaleItemFloatsUseCase';
import { SyncStoreItemsUseCase } from '../../store/application/SyncStoreItemsUseCase';

export class MarketController {
  constructor(
    private getMarketListingsUseCase: GetMarketListingsUseCase,
    private getMarketStoreAssetsUseCase: GetMarketStoreAssetsUseCase,
    private syncMarketListingsUseCase: SyncMarketListingsUseCase,
    private getResaleItemFloatsUseCase: GetResaleItemFloatsUseCase,
    private syncStoreItemsUseCase: SyncStoreItemsUseCase,
  ) {}

  /** GET /market/listings — tienda pública: assets YouPin con float; ?all=true = catálogo agrupado (admin) */
  async getListings(req: Request, res: Response): Promise<void> {
    try {
      const includeWithoutFloats =
        req.query.all === "true" || req.query.includeWithoutFloats === "true";

      if (includeWithoutFloats) {
        const listings = await this.getMarketListingsUseCase.execute({
          includeWithoutFloats: true,
        });
        res.json(listings);
        return;
      }

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
      console.log('[Market Controller] Solicitud de sincronización manual completa recibida. Ejecutando en segundo plano para evitar timeouts...');

      // Responder de inmediato para evitar timeout HTTP en el navegador o proxy (p. ej. Cloudflare o Nginx)
      res.json({
        message: 'Sincronización manual completa iniciada en segundo plano con éxito. El proceso demorará entre 30 y 45 segundos en actualizar el catálogo de YouPin y el stock de los bots.',
      });

      // Ejecución asíncrona en segundo plano sin bloquear la respuesta HTTP
      (async () => {
        try {
          console.log('[Market Sync Background] Iniciando actualización del catálogo...');
          const result = await this.syncMarketListingsUseCase.execute();
          console.log(`[Market Sync Background] Catálogo YouPin actualizado: ${result.synced} listings, ${result.skipped} assets omitidos, ${result.assetsFetched} assets (${result.rowsUsed} filas API).`);

          console.log('[Market Sync Background] Iniciando actualización de inventario de bots...');
          await this.syncStoreItemsUseCase.execute();
          console.log('[Market Sync Background] Sincronización completa finalizada con éxito.');
        } catch (err: any) {
          console.error('[Market Sync Background Error] Error durante la sincronización en segundo plano:', err.message || err);
        }
      })();

    } catch (error: any) {
      console.error('[Market Controller] Error al iniciar sincronización:', error);
      res.status(500).json({ error: error.message || 'Error al iniciar la sincronización.' });
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
