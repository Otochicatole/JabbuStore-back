import { StoreItem } from './Item';

export interface IStoreRepository {
  findAll(): Promise<StoreItem[]>;
  clearAndSaveMany(items: StoreItem[]): Promise<void>;
}
