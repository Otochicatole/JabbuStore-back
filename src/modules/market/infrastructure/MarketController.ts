import { Request, Response } from 'express';
import { GetMarketListingsUseCase } from '../application/GetMarketListingsUseCase';
import { SyncMarketListingsUseCase } from '../application/SyncMarketListingsUseCase';
import { GetResaleItemFloatsUseCase } from '../application/GetResaleItemFloatsUseCase';
import { SyncStoreItemsUseCase } from '../../store/application/SyncStoreItemsUseCase';

export class MarketController {
  constructor(
    private getMarketListingsUseCase: GetMarketListingsUseCase,
    private syncMarketListingsUseCase: SyncMarketListingsUseCase,
    private getResaleItemFloatsUseCase: GetResaleItemFloatsUseCase,
    private syncStoreItemsUseCase: SyncStoreItemsUseCase,
  ) {}

  /** GET /market/listings — devuelve todos los listings con displayPrice */
  async getListings(_req: Request, res: Response): Promise<void> {
    try {
      const listings = await this.getMarketListingsUseCase.execute();
      res.json(listings);
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
          console.log(`[Market Sync Background] Catálogo actualizado: ${result.synced} items guardados, ${result.skipped} omitidos.`);

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
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Falta el ID del artículo de reventa.' });
        return;
      }
      const floats = await this.getResaleItemFloatsUseCase.execute(id as string);
      res.json(floats);
    } catch (error: any) {
      console.error('[Market Controller] Error obteniendo floats:', error);
      res.status(500).json({ error: error.message || 'Error al obtener los floats del artículo.' });
    }
  }
}
