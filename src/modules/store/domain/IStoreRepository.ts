import { StoreItem } from './Item';

export interface StorePriceUpdate {
  assetId: string;
  name: string;
  price: number;
}

export interface IStoreRepository {
  findAll(): Promise<StoreItem[]>;
  clearAndSaveMany(items: StoreItem[]): Promise<void>;
  /** Actualiza precios/nombres in-place; respeta isPriceManual. */
  updatePricesMany(updates: StorePriceUpdate[]): Promise<number>;
}
