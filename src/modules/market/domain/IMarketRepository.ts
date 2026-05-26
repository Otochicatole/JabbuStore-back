import { MarketListing, MarketListingUpsert } from './MarketListing';

export interface IMarketRepository {
  /** Reemplaza todo el catálogo con los listings nuevos (sync completo) */
  replaceAll(listings: MarketListingUpsert[]): Promise<void>;

  /** Devuelve todos los listings activos */
  findAll(): Promise<MarketListing[]>;

  /** Actualiza el precio de un listing manualmente */
  updatePrice(id: string, price: number): Promise<void>;
}
