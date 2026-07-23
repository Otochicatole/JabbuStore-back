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

const marketAssetsSyncIntervalMinutes = toPositiveInteger(
  process.env.MARKET_ASSETS_SYNC_INTERVAL_MINUTES ||
    process.env.FULL_CATALOG_SYNC_INTERVAL_MINUTES,
  300,
);
const marketAssetsMaxConcurrency = Math.min(
  48,
  toPositiveInteger(process.env.MARKET_ASSETS_CONCURRENCY, 48),
);
const marketAssetsInitialConcurrency = Math.min(
  marketAssetsMaxConcurrency,
  Math.min(
    48,
    toPositiveInteger(process.env.MARKET_ASSETS_INITIAL_CONCURRENCY, 6),
  ),
);

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || '',
  sessionSecret: process.env.SESSION_SECRET || '',
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
  
  /** Habilitar/deshabilitar sólo el scheduler de assets del Global Market. */
  enableSync: process.env.ENABLE_SYNC === 'true',
  /** Habilitar/deshabilitar solo el scheduler automático del catálogo local de precios. */
  enableItemsCatalogSync: process.env.ENABLE_ITEMS_CATALOG_SYNC === 'true',

  /**
   * Configuración del indexado de floats (endpoint /steam/api/float/assets).
   *
   * El límite se mide en assets solicitados, no en requests HTTP. Cada llamada
   * consume tantas unidades como su `limit`; el valor canónico actual es 10.000/min.
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
    /**
     * Assets/minuto disponibles en float/assets. El proveedor contabiliza cada fila
     * solicitada, por lo que una petición con limit=10 reserva 10 unidades.
     */
    maxRowsPerMinute: toPositiveInteger(
      process.env.FLOAT_SYNC_MAX_ASSETS_PER_MINUTE ||
        process.env.FLOAT_SYNC_MAX_ROWS_PER_MIN,
      10_000,
    ),
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
    /** Tope legacy por ejecución del reindexado manual (el scheduler está retirado). */
    reindexRowBudget: parseInt(process.env.FLOAT_SYNC_ROW_BUDGET || '4500', 10),
    /** Considera fresco un float sincronizado hace menos de estos minutos (no re-sincroniza). */
    freshnessMinutes: parseInt(process.env.FLOAT_SYNC_FRESHNESS_MINUTES || '1440', 10),
  },

  /**
   * Sync del catálogo YouPin vía GET /steam/api/float/assets (source=youpin).
   * Query params: source=youpin, only_market_id=1, with_items=1, sort=newest (catálogo vivo).
   * Flujo legacy incremental. El snapshot canónico vive en marketAssetsCatalog.
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
    /** Presupuesto máximo de FILAS SteamWebAPI consumidas por corrida priorizada. */
    priorityRowBudget: parseInt(process.env.MARKET_SYNC_PRIORITY_ROW_BUDGET || '1000', 10),
    /** Filas pedidas por cada item consultado por market_hash_name. */
    priorityRowsPerItem: parseInt(process.env.MARKET_SYNC_PRIORITY_ROWS_PER_ITEM || '10', 10),
  },

  /** Snapshot transaccional del Global Market obtenido desde float/assets. */
  marketAssetsCatalog: {
    target: toPositiveInteger(process.env.MARKET_ASSETS_TARGET, 10_000),
    assetsPerItem: Math.min(
      10,
      toPositiveInteger(process.env.MARKET_ASSETS_PER_ITEM, 10),
    ),
    /** Techo adaptativo de requests simultáneos. */
    concurrency: marketAssetsMaxConcurrency,
    /** Workers iniciales antes de medir latencia y salud del proveedor. */
    initialConcurrency: marketAssetsInitialConcurrency,
    /** Objetivo SLO; no habilita publicación parcial al vencer. */
    targetDurationSeconds: toPositiveInteger(
      process.env.MARKET_ASSETS_TARGET_DURATION_SECONDS,
      600,
    ),
    sort: (process.env.MARKET_ASSETS_SORT || 'newest') as
      | 'newest'
      | 'oldest'
      | 'lowest_float'
      | 'highest_float',
    snapshotPath:
      process.env.MARKET_ASSETS_CATALOG_PATH ||
      process.env.MARKET_ASSETS_SNAPSHOT_PATH ||
      'steamwebapi-json-data/market-assets-catalog.json',
    checkpointPath:
      process.env.MARKET_ASSETS_CHECKPOINT_PATH ||
      process.env.MARKET_ASSETS_PENDING_PATH ||
      'steamwebapi-json-data/market-assets-checkpoint.json',
    maxResponseBytes: toPositiveInteger(
      process.env.MARKET_ASSETS_MAX_RESPONSE_BYTES,
      8 * 1024 * 1024,
    ),
  },

  /** Scheduler independiente del snapshot de assets del Global Market. */
  marketAssetsSync: {
    intervalMinutes: marketAssetsSyncIntervalMinutes,
  },

  /** @deprecated Alias interno para código anterior a la separación de jobs. */
  fullCatalogSync: {
    intervalMinutes: marketAssetsSyncIntervalMinutes,
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
    syncIntervalMinutes: toPositiveInteger(
      process.env.ITEMS_CATALOG_SYNC_INTERVAL_MINUTES ||
        process.env.STORE_SYNC_INTERVAL_MINUTES,
      300,
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
