import { Request, Response } from 'express';
import { GetStoreItemsUseCase } from '../application/GetStoreItemsUseCase';
import { PrismaStoreRepository } from './PrismaStoreRepository';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';

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
      console.log('[StoreController] Sincronizando precios de inventario de bots con catálogo...');
      const items = await this.storeRepository.findAll();
      const pricedItems = await PriceEnrichmentService.enrichItemsWithMarketPrices(items);
      await this.storeRepository.clearAndSaveMany(pricedItems);
      res.json({
        message: `Sincronización de precios finalizada. ${pricedItems.length} items de bots actualizados.`,
      });
    } catch (error: any) {
      console.error('[StoreController Error] Failed to sync bot prices:', error);
      res.status(500).json({ error: error.message || 'Failed to sync bot prices.' });
    }
  }
}
