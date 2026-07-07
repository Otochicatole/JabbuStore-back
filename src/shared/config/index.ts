import dotenv from 'dotenv';
import { AdminSecureConfigService } from '../../modules/marketplace/application/AdminSecureConfigService';

dotenv.config();

const toBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value === '') return fallback;
  return value !== 'false';
};

const toNumber = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Math.trunc(toNumber(value, fallback));
  return parsed > 0 ? parsed : fallback;
};

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'secret',
  sessionSecret: process.env.SESSION_SECRET || 'session-secret',
  steamApiKey: process.env.STEAM_API_KEY || '',
  steamwebapiApiKey: process.env.STEAMWEBAPI_API_KEY || '',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:3001',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  
  /**
   * Intervalo de actualización automática de la base de datos de ítems para venta (en minutos).
   * Refresca los inventarios desde Steam hacia la base de datos local.
   * Se puede configurar mediante la variable de entorno STORE_SYNC_INTERVAL_MINUTES.
   */
  storeSyncIntervalMinutes: parseInt(process.env.STORE_SYNC_INTERVAL_MINUTES || '180', 10),
  
  /**
   * Habilitar o deshabilitar la sincronización automática periódica con Steam Web API.
   */
  enableSync: process.env.ENABLE_SYNC === 'true',
  /** Habilitar/deshabilitar solo el scheduler automático del catálogo local de precios. */
  enableItemsCatalogSync: process.env.ENABLE_ITEMS_CATALOG_SYNC === 'true',

  /**
   * Configuración del indexado de floats (endpoint /steam/api/float/assets).
   *
   * IMPORTANTE — modelo de rate limit del plan "Float Small" (confirmado por headers
   * x-ratelimit-*): el límite se mide en FILAS, no en requests. Cada request consume
   * tantas unidades como el parámetro `limit`. Cupo: 100 filas/min, 5.000/día, 50.000/mes.
   */
  floatSync: {
    /** Máximo de floats que se guardan/piden por listing (on-demand; luego se ordena por precio). */
    maxPerItem: parseInt(process.env.FLOAT_SYNC_MAX_PER_ITEM || '12', 10),
    /** sort en float/assets para sync por skin (modal): lowest_float = mejor wear primero. */
    sort: (process.env.FLOAT_SYNC_SORT || 'lowest_float') as
      | 'newest'
      | 'oldest'
      | 'lowest_float'
      | 'highest_float',
    /** Tamaño de página para escanear Dopplers (necesitan barrer varias fases). Tope API = 50. */
    pageSize: parseInt(process.env.FLOAT_SYNC_PAGE_SIZE || '50', 10),
    /** Páginas máximas a escanear en Dopplers para encontrar la fase correcta. */
    maxPages: parseInt(process.env.FLOAT_SYNC_MAX_PAGES || '3', 10),
    /** Filas/min máximas a consumir (margen de seguridad bajo el límite real de 100). */
    maxRowsPerMinute: parseInt(process.env.FLOAT_SYNC_MAX_ROWS_PER_MIN || '90', 10),
    /**
     * Habilitar el REINDEXADO MASIVO en background. Apagado por defecto: consume el
     * cupo del plan indexando miles de ítems. Los floats se piden bajo demanda (modal).
     * Activar solo si se quiere precalentar el catálogo (con FLOAT_SYNC_ENABLE_REINDEX=true).
     */
    enableReindex: process.env.FLOAT_SYNC_ENABLE_REINDEX === 'true',
    /** Habilitar CSFloat como fuente de respaldo en el sync on-demand (modal). */
    enableCsfloatFallback: process.env.FLOAT_SYNC_ENABLE_CSFLOAT !== 'false',
    /** Habilitar CSFloat en el reindexado masivo (consume más cupo de filas). */
    enableCsfloatInReindex: process.env.FLOAT_SYNC_REINDEX_CSFLOAT === 'true',
    /** Tope de FILAS por ejecución del reindexado (seguro bajo el límite diario de 5.000). */
    reindexRowBudget: parseInt(process.env.FLOAT_SYNC_ROW_BUDGET || '4500', 10),
    /** Considera fresco un float sincronizado hace menos de estos minutos (no re-sincroniza). */
    freshnessMinutes: parseInt(process.env.FLOAT_SYNC_FRESHNESS_MINUTES || '1440', 10),
  },

  /**
   * Sync del catálogo YouPin vía GET /steam/api/float/assets (source=youpin).
   * Query params: source=youpin, only_market_id=1, with_items=1, sort=newest (catálogo vivo).
   * Cada fila = un asset real con float; limit=50 por página (tope plan Float Small).
   */
  marketSync: {
    pageSize: parseInt(process.env.MARKET_SYNC_PAGE_SIZE || '100', 10),
    maxPages: parseInt(process.env.MARKET_SYNC_MAX_PAGES || '100', 10),
    /** Filtro local post-API; 0 = solo descarta precio ≤ 0. No existe en query params de SteamWebAPI. */
    minPrice: parseFloat(process.env.MARKET_SYNC_MIN_PRICE || '0.1'),
    sort: (process.env.MARKET_SYNC_SORT || 'newest') as
      | 'newest'
      | 'oldest'
      | 'lowest_float'
      | 'highest_float',
  },

  /** Legacy/diagnóstico: GET /market/youpin/prices (MCP Market Prices). */
  youpinPrices: {
    market: 'youpin' as const,
    currency: process.env.YOUPIN_PRICES_CURRENCY || 'USD',
    cacheTtlMs: parseInt(process.env.YOUPIN_PRICES_CACHE_TTL_MS || '300000', 10),
  },

  /** Legacy/diagnóstico puntual: GET /steam/api/item?markets=youpin. */
  itemsPrices: {
    market: process.env.ITEMS_PRICES_MARKET || 'youpin',
    currency: process.env.ITEMS_PRICES_CURRENCY || 'USD',
    cacheTtlMs: parseInt(process.env.ITEMS_PRICES_CACHE_TTL_MS || '300000', 10),
    enableItemsApiPricing: process.env.ITEMS_PRICES_ENABLE !== 'false',
  },

  /** Catálogo local de precios de bots vía GET /steam/api/items. */
  itemsCatalog: {
    path: process.env.ITEMS_CATALOG_PATH || 'steamwebapi-json-data/items-catalog.json',
    market: process.env.ITEMS_CATALOG_MARKET || process.env.ITEMS_PRICES_MARKET || 'youpin',
    currency: process.env.ITEMS_CATALOG_CURRENCY || process.env.ITEMS_PRICES_CURRENCY || 'USD',
    pageSize: parseInt(process.env.ITEMS_CATALOG_PAGE_SIZE || '50000', 10),
    maxPages: parseInt(process.env.ITEMS_CATALOG_MAX_PAGES || '10', 10),
    syncIntervalMinutes: parseInt(
      process.env.ITEMS_CATALOG_SYNC_INTERVAL_MINUTES ||
        process.env.STORE_SYNC_INTERVAL_MINUTES ||
        '720',
      10,
    ),
    staleAfterMs: parseInt(process.env.ITEMS_CATALOG_STALE_AFTER_MS || '86400000', 10),
    select:
      process.env.ITEMS_CATALOG_SELECT ||
      'markethashname,marketname,normalizedname,pricereal,pricemix,pricelatest,prices,paintindex,variants,itemgroup,itemname,itemtype,wear,isstattrak,issouvenir,image',
  },

  /**
   * Respaldo de precios para bots cuando YouPin no tiene fila/variant.
   * GET /markets/prices?markets=buff,csfloat&market_hash_name=...
   */
  botPrices: {
    enableSecondaryMarkets: process.env.BOT_PRICE_ENABLE_SECONDARY !== 'false',
    /** Mercados de respaldo; `buff` se descarga en bulk junto a YouPin al sync de bots. */
    secondaryMarkets: (process.env.BOT_PRICE_SECONDARY_MARKETS || 'buff')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  },
};

export async function applyRuntimeConfigOverrides() {
  const runtime = await AdminSecureConfigService.getRuntimeSettings();

  config.steamApiKey = await AdminSecureConfigService.getSecretValue('STEAM_API_KEY');
  config.steamwebapiApiKey = await AdminSecureConfigService.getSecretValue('STEAMWEBAPI_API_KEY');

  config.storeSyncIntervalMinutes = toPositiveInteger(
    runtime.STORE_SYNC_INTERVAL_MINUTES,
    config.storeSyncIntervalMinutes,
  );
  config.enableSync = toBoolean(runtime.ENABLE_SYNC, config.enableSync);
  config.enableItemsCatalogSync = toBoolean(
    runtime.ENABLE_ITEMS_CATALOG_SYNC,
    config.enableItemsCatalogSync,
  );
  config.itemsCatalog.syncIntervalMinutes = toPositiveInteger(
    runtime.ITEMS_CATALOG_SYNC_INTERVAL_MINUTES,
    config.itemsCatalog.syncIntervalMinutes,
  );
  config.marketSync.pageSize = toPositiveInteger(
    runtime.MARKET_SYNC_PAGE_SIZE,
    config.marketSync.pageSize,
  );
  config.marketSync.maxPages = toPositiveInteger(
    runtime.MARKET_SYNC_MAX_PAGES,
    config.marketSync.maxPages,
  );
  config.marketSync.minPrice = toNumber(
    runtime.MARKET_SYNC_MIN_PRICE,
    config.marketSync.minPrice,
  );
  if (
    runtime.MARKET_SYNC_SORT === 'newest' ||
    runtime.MARKET_SYNC_SORT === 'oldest' ||
    runtime.MARKET_SYNC_SORT === 'lowest_float' ||
    runtime.MARKET_SYNC_SORT === 'highest_float'
  ) {
    config.marketSync.sort = runtime.MARKET_SYNC_SORT;
  }
  if (
    runtime.FLOAT_SYNC_SORT === 'newest' ||
    runtime.FLOAT_SYNC_SORT === 'oldest' ||
    runtime.FLOAT_SYNC_SORT === 'lowest_float' ||
    runtime.FLOAT_SYNC_SORT === 'highest_float'
  ) {
    config.floatSync.sort = runtime.FLOAT_SYNC_SORT;
  }
}
