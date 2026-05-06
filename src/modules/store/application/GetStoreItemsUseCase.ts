import { StoreItem } from '../domain/Item';
import { IStoreRepository } from '../domain/IStoreRepository';

export class GetStoreItemsUseCase {
  constructor(private storeRepository: IStoreRepository) {}

  async execute(): Promise<StoreItem[]> {
    return this.storeRepository.findAll();
  }
}
