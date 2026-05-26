import { Request, Response } from 'express';
import { GetMarketListingsUseCase } from '../application/GetMarketListingsUseCase';
import { SyncMarketListingsUseCase } from '../application/SyncMarketListingsUseCase';

export class MarketController {
  constructor(
    private getMarketListingsUseCase: GetMarketListingsUseCase,
    private syncMarketListingsUseCase: SyncMarketListingsUseCase,
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

  /** POST /market/sync — dispara sincronización manual desde el panel de admin */
  async triggerSync(_req: Request, res: Response): Promise<void> {
    try {
      const result = await this.syncMarketListingsUseCase.execute();
      res.json({
        message: `Sincronización completada. ${result.synced} listings guardados, ${result.skipped} omitidos.`,
        ...result,
      });
    } catch (error) {
      console.error('[Market Controller] Error en sincronización:', error);
      res.status(500).json({ error: 'Error durante la sincronización del catálogo de mercado.' });
    }
  }
}
