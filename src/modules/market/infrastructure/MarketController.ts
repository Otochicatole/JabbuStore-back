import { Request, Response } from 'express';
import { GetMarketStoreAssetsUseCase } from '../application/GetMarketStoreAssetsUseCase';
import { GetOrRefreshListingFloatsUseCase } from '../application/GetOrRefreshListingFloatsUseCase';
import { GetListingInspectLinkUseCase } from '../application/GetListingInspectLinkUseCase';
import { SteamWebApiFloatAssetsClient } from './SteamWebApiFloatAssetsClient';
import { itemsCatalogRefreshService } from '../../pricing/application/ItemsCatalogRefreshService';
import { GenerateCatalogGlobalUseCase } from '../application/GenerateCatalogGlobalUseCase';
import {
  catalogFiltersFromSettings,
  type CatalogFilters,
} from '../application/GenerateCatalogGlobalUseCase';
import { PrismaMarketRepository } from './PrismaMarketRepository';
import { prisma } from '../../../shared/infrastructure/PrismaClient';

export class MarketController {
  private generateCatalogGlobalUseCase = new GenerateCatalogGlobalUseCase();

  constructor(
    private getMarketStoreAssetsUseCase: GetMarketStoreAssetsUseCase,
    private getOrRefreshListingFloatsUseCase: GetOrRefreshListingFloatsUseCase,
    private marketRepository = new PrismaMarketRepository(),
    private getListingInspectLinkUseCase = new GetListingInspectLinkUseCase(
      new SteamWebApiFloatAssetsClient(),
    ),
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
  /** POST /market/generate-catalog-global — Paso 2: Generar catalog-global.json con filtros */
  async generateCatalogGlobal(_req: Request, res: Response): Promise<void> {
    try {
      console.log('[Market Controller] Iniciando Paso 2: Generar catalog-global.json...');

      const adminSettings = await prisma.adminSettings.findFirst();
      const filters: CatalogFilters | undefined = adminSettings
        ? catalogFiltersFromSettings(adminSettings)
        : undefined;

      const result = await this.generateCatalogGlobalUseCase.execute(filters);
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
      const rawId = decodeURIComponent(req.params.id as string);
      if (!rawId) {
        res.status(400).json({ error: 'Falta el ID del artículo de reventa.' });
        return;
      }

      const dopplerPhaseSuffix = /\s*\|\s*(Phase [1-4]|Ruby|Sapphire|Black Pearl|Emerald)\s*$/i;
      const phaseMatch = rawId.match(dopplerPhaseSuffix);
      const phase = phaseMatch ? phaseMatch[1] : undefined;
      const listingId = rawId.replace(dopplerPhaseSuffix, '').trim();
      
      const options = {
        ...(phase ? { phase } : {}),
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
        sortBy: (req.query.sortBy as 'float_asc' | 'float_desc' | 'price_asc' | 'price_desc') || 'float_asc',
        forceRefresh: req.query.forceRefresh === 'true',
      };
      
      const result = await this.getOrRefreshListingFloatsUseCase.execute(listingId, options);
      res.json(result.floats);
    } catch (error: any) {
      console.error('[Market Controller] Error obteniendo floats:', error);
      res.status(500).json({ error: error.message || 'Error al obtener los floats del artículo.' });
    }
  }

  /** GET /market/listings/:id/inspect — devuelve solo un enlace Steam validado. */
  async getInspectLink(req: Request, res: Response): Promise<void> {
    try {
      const marketHashName = decodeURIComponent(req.params.id as string).trim();
      if (!marketHashName) {
        res.status(400).json({ inspectLink: null });
        return;
      }

      const inspectLink = await this.getListingInspectLinkUseCase.execute(marketHashName);
      res.json({ inspectLink });
    } catch (error: any) {
      console.error('[Market Controller] Error obteniendo inspect link:', error);
      res.status(500).json({ inspectLink: null });
    }
  }
}
