import { FloatItem } from './FloatItem';

export interface IMarketRepository {
  /** Guarda los floats asociados a un listing de mercado de forma atómica */
  saveFloats(listingId: string, floats: FloatItem[]): Promise<void>;

  /** Obtiene todos los floats guardados para un listing de mercado */
  findFloatsByListingId(listingId: string): Promise<FloatItem[]>;

  /**
   * Marca como available = false todos los FloatItem de YOUPIN para el listing
   * cuyo assetId NO esté en presentAssetIds.
   * Solo afecta market = 'YOUPIN' y listingId = id dado.
   * Devuelve la cantidad de assets invalidados.
   */
  invalidateAbsentFloats(listingId: string, presentAssetIds: string[]): Promise<number>;
}
