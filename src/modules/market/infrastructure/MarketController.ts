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
      console.log('[Market Controller] Iniciando sincronización manual completa (Catálogo + Bots)...');
      
      // 1. Sincronizar catálogo de YouPin
      const result = await this.syncMarketListingsUseCase.execute();
      
      // 2. Sincronizar inventario de los bots
      await this.syncStoreItemsUseCase.execute();

      res.json({
        message: `Sincronización completada con éxito. Catálogo: ${result.synced} items sincronizados, ${result.skipped} omitidos. Inventario de bots actualizado.`,
        synced: result.synced,
        skipped: result.skipped,
      });
    } catch (error: any) {
      console.error('[Market Controller] Error en sincronización:', error);
      res.status(500).json({ error: error.message || 'Error durante la sincronización completa.' });
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
