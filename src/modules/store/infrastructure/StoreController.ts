import { Request, Response } from 'express';
import { GetStoreItemsUseCase } from '../application/GetStoreItemsUseCase';

export class StoreController {
  constructor(private getStoreItemsUseCase: GetStoreItemsUseCase) {}

  async getItems(req: Request, res: Response) {
    try {
      const items = await this.getStoreItemsUseCase.execute();
      res.json(items);
    } catch (error: any) {
      console.error('[StoreController Error] Failed to get items:', error);
      res.status(500).json({ error: error.message || 'Failed to retrieve store items' });
    }
  }
}
