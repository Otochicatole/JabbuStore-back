import { Request, Response } from 'express';
import { GetMarketStoreAssetsUseCase } from '../application/GetMarketStoreAssetsUseCase';
import { GetOrRefreshListingFloatsUseCase } from '../application/GetOrRefreshListingFloatsUseCase';
import { itemsCatalogRefreshService } from '../../pricing/application/ItemsCatalogRefreshService';
import { GenerateCatalogGlobalUseCase } from '../application/GenerateCatalogGlobalUseCase';
import { PrismaMarketRepository } from './PrismaMarketRepository';

export class MarketController {
  private generateCatalogGlobalUseCase = new GenerateCatalogGlobalUseCase();

  constructor(
    private getMarketStoreAssetsUseCase: GetMarketStoreAssetsUseCase,
    private getOrRefreshListingFloatsUseCase: GetOrRefreshListingFloatsUseCase,
    private marketRepository = new PrismaMarketRepository(),
  ) {}

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
