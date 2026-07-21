/** Desgaste Steam — condición del item, no variante independiente. */
export type WearCondition =
  | "Factory New"
  | "Minimal Wear"
  | "Field-Tested"
  | "Well-Worn"
  | "Battle-Scarred";

export type ItemCategory = "weapon" | "knife" | "glove" | "other";

export type PriceMarket = "youpin" | "buff" | "csfloat" | (string & {});

export type PriceSource =
  | "steamwebapi_market_exact"
  | "steamwebapi_market_variant"
  | "steamwebapi_secondary_exact"
  | "steamwebapi_secondary_variant"
  | "steamwebapi_items_exact"
  | "steamwebapi_items_variant"
  | "steamwebapi_items_catalog_exact"
  | "steamwebapi_items_catalog_variant"
  | "fallback_local"
  | "none";

/** Fila cruda de GET /market/youpin/prices (alias de /market/{market}/prices). */
export type YoupinVariantValue = number | { price?: number; quantity?: number };

export interface SteamWebApiYoupinPriceRow {
  market_hash_name: string;
  price: number;
  quantity?: number;
  createdat?: string;
  variants?: Record<string, YoupinVariantValue> | null;
}

export type YoupinMarketPriceRow = SteamWebApiYoupinPriceRow;

/**
 * Fila de GET /markets/prices (precios agrupados por mercado).
 * Documentado en SteamWebAPI MCP — cada item incluye `prices[market]`.
 */
export interface SteamWebApiMarketsPriceRow {
  market_hash_name: string;
  prices: Partial<
    Record<
      string,
      {
        price: number;
        quantity?: number;
        createdat?: string;
        variants?: Record<string, YoupinVariantValue> | null;
      }
    >
  >;
}

export interface NormalizedMarketItem {
  marketHashName: string;
  itemCategory: ItemCategory;
  weaponName: string | null;
  skinName: string | null;
  finishName: string | null;
  /** Fase Doppler/Gamma reconocida por mercado (Phase 1, Ruby, Emerald, …). */
  variantName: string | null;
  wear: WearCondition | null;
  isStatTrak: boolean;
  isSouvenir: boolean;
  isVanilla: boolean;
  /** Patrón comunitario (Blue Gem, Fire & Ice) — metadata, no item independiente. */
  patternType: string | null;
  isPatternBased: boolean;
  isIndependentVariant: boolean;
}

export interface VariantClassification {
  normalized: NormalizedMarketItem;
  independentVariantReasons: string[];
  metadataOnlyReasons: string[];
  warnings: string[];
}

export interface PriceLookupResult {
  price: number | null;
  currency: string;
  market: PriceMarket;
  source: PriceSource;
  lookupKey: string;
  variantKey: string | null;
  classification: VariantClassification;
  apiRowFound: boolean;
}

export interface BotPriceSyncStats {
  total: number;
  pricedExact: number;
  pricedVariant: number;
  pricedSecondary: number;
  fallback: number;
  unpriced: number;
  warnings: string[];
}

export interface PriceableBotItem {
  assetId: string;
  classId: string;
  name: string;
  type: string;
  price: number;
  iconUrl?: string | null;
  pattern?: number | null;
  paintIndex?: number | null;
}

export type PriceCatalog = Map<string, SteamWebApiYoupinPriceRow>;

/** Catálogos bulk para pricing de bots (YouPin primario + Buff respaldo). */
export interface BotPriceCatalogBundle {
  youpin: PriceCatalog;
  buff: PriceCatalog;
}

export interface BotPriceCatalogFetchResult {
  bundle: BotPriceCatalogBundle;
  /** Al menos uno de los catálogos tiene filas utilizables. */
  catalogAvailable: boolean;
  errors: string[];
}

export interface SteamWebApiItemMarketPrice {
  source?: string;
  name?: string;
  price?: number;
  quantity?: number;
  createdat?: string;
  created_at?: string;
}

export interface SteamWebApiItemVariant {
  phase?: string;
  paintindex?: number;
  paint_index?: number;
  pricereal?: number;
  pricemix?: number;
  pricelatest?: number;
  image?: string;
}

export interface SteamWebApiItemDetailsRow {
  markethashname?: string;
  market_hash_name?: string;
  marketname?: string;
  pricereal?: number;
  pricemix?: number;
  pricelatest?: number;
  paintindex?: number;
  prices?: SteamWebApiItemMarketPrice[];
  variants?: SteamWebApiItemVariant[];
}

export interface SteamWebApiItemsPriceResult {
  item: SteamWebApiItemDetailsRow | null;
  ok: boolean;
  status: number;
  error?: string;
}

export interface SteamWebApiItemsCatalogRow extends SteamWebApiItemDetailsRow {
  id?: string;
  normalizedname?: string;
  marketname?: string;
  image?: string;
  pricesafe?: number;
  pricereal24h?: number;
  pricereal7d?: number;
  pricereal30d?: number;
  pricereal90d?: number;
  wear?: string;
  isstattrak?: boolean;
  issouvenir?: boolean;
  itemgroup?: string;
  itemname?: string;
  itemtype?: string;
}

export interface SteamWebApiItemsCatalogSnapshot {
  fetchedAt: string;
  currency: string;
  market: string;
  sourceUrl: string;
  pageCount: number;
  itemCount: number;
  errors: string[];
  items: SteamWebApiItemsCatalogRow[];
}

export interface SteamWebApiItemsCatalogIndex {
  rowsByName: Map<string, SteamWebApiItemsCatalogRow[]>;
  itemCount: number;
  fetchedAt: string | null;
}

export interface BotPriceCatalogStatus {
  exists: boolean;
  stale: boolean;
  fetchedAt: string | null;
  itemCount: number;
  pageCount: number;
  currency: string;
  market: string;
  path: string;
  lastError?: string;
  running?: boolean;
  lastStartedAt?: string | null;
  lastFinishedAt?: string | null;
  lastItemCount?: number | null;
  triggeredBy?: string | null;
  currentPage?: number;
  currentItemCount?: number;
  totalPages?: number;
}
