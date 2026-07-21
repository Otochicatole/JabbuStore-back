import { MarketListing, MarketListingUpsert } from './MarketListing';
import { FloatItem } from './FloatItem';
import { MarketStoreAsset } from './MarketStoreAsset';

export interface IMarketRepository {
  /** Reemplaza todo el catálogo con los listings nuevos (sync completo) */
  replaceAll(listings: MarketListingUpsert[]): Promise<void>;

  /** Upsert listings + floats indexados desde float/assets YouPin */
  syncCatalogWithFloats(
    listings: MarketListingUpsert[],
    floatsByName: Map<string, Omit<FloatItem, 'resaleItemId'>[]>,
  ): Promise<void>;

  /** Upsert incremental: solo toca los listings consultados en esta corrida. */
  syncCatalogSliceWithFloats(
    listings: MarketListingUpsert[],
    floatsByName: Map<string, Omit<FloatItem, 'resaleItemId'>[]>,
    emptyListingNames: string[],
  ): Promise<void>;

  /**
   * Publica un snapshot completo de YouPin en una unica transaccion. El catalogo
   * anterior permanece visible hasta el commit y los listings manuales conservan
   * su precio.
   */
  replaceAutomaticCatalogWithFloats(
    listings: MarketListingUpsert[],
    floatsByName: Map<string, Omit<FloatItem, 'resaleItemId'>[]>,
  ): Promise<void>;

  /** Devuelve todos los listings activos */
  findAll(): Promise<MarketListing[]>;

  /** Catálogo público de reventa (precio válido, sin exigir floats pre-indexados) */
  findAllForStore(): Promise<MarketListing[]>;

  /** Assets YouPin individuales con float para la tienda pública */
  findStoreAssets(): Promise<Omit<MarketStoreAsset, 'id'>[]>;

  /** Listings con al menos un FloatItem disponible (reventa real en YouPin) */
  findAllWithAvailableFloats(): Promise<MarketListing[]>;

  /** Actualiza el precio de un listing manualmente */
  updatePrice(id: string, price: number): Promise<void>;

  /** Guarda los floats asociados a un listing de mercado de forma atómica */
  saveFloats(resaleItemId: string, floats: FloatItem[]): Promise<void>;

  /** Deriva price/youpinAsk del listing desde el mínimo FloatItem (solo no manuales). */
  syncListingPriceFromFloats(resaleItemId: string): Promise<void>;

  /** Devuelve listings elegibles para float (con desgaste), priorizando los menos actualizados */
  findFloatEligibleForReindex(limit: number): Promise<{ id: string; name: string }[]>;

  /** Obtiene todos los floats guardados para un listing de mercado */
  findFloatsByResaleItemId(resaleItemId: string): Promise<FloatItem[]>;
}
