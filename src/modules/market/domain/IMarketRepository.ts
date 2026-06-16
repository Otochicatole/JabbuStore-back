import { MarketListing, MarketListingUpsert } from './MarketListing';
import { FloatItem } from './FloatItem';

export interface IMarketRepository {
  /** Reemplaza todo el catálogo con los listings nuevos (sync completo) */
  replaceAll(listings: MarketListingUpsert[]): Promise<void>;

  /** Devuelve todos los listings activos */
  findAll(): Promise<MarketListing[]>;

  /** Actualiza el precio de un listing manualmente */
  updatePrice(id: string, price: number): Promise<void>;

  /** Guarda los floats asociados a un listing de mercado de forma atómica */
  saveFloats(resaleItemId: string, floats: FloatItem[]): Promise<void>;

  /** Obtiene todos los floats guardados para un listing de mercado */
  findFloatsByResaleItemId(resaleItemId: string): Promise<FloatItem[]>;
}
