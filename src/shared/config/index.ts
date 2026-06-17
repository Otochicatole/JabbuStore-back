import dotenv from 'dotenv';

dotenv.config();

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
  storeSyncIntervalMinutes: parseInt(process.env.STORE_SYNC_INTERVAL_MINUTES || '10', 10),
  
  /**
   * Habilitar o deshabilitar la sincronización automática periódica con Steam Web API.
   */
  enableSync: process.env.ENABLE_SYNC !== 'false',

  /**
   * Configuración del indexado de floats (endpoint /steam/api/float/assets).
   *
   * IMPORTANTE — modelo de rate limit del plan "Float Small" (confirmado por headers
   * x-ratelimit-*): el límite se mide en FILAS, no en requests. Cada request consume
   * tantas unidades como el parámetro `limit`. Cupo: 100 filas/min, 5.000/día, 50.000/mes.
   */
  floatSync: {
    /** Máximo de floats que se guardan/piden por listing (los de menor float primero). */
    maxPerItem: parseInt(process.env.FLOAT_SYNC_MAX_PER_ITEM || '12', 10),
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
   * Cada fila = un asset real con float; limit=20 por página según plan Float Small.
   */
  marketSync: {
    pageSize: parseInt(process.env.MARKET_SYNC_PAGE_SIZE || '20', 10),
    maxPages: parseInt(process.env.MARKET_SYNC_MAX_PAGES || '50', 10),
    minPrice: parseFloat(process.env.MARKET_SYNC_MIN_PRICE || '0.5'),
  },

  /** Precios YouPin para bots: GET /market/youpin/prices (MCP Market Prices). */
  youpinPrices: {
    market: 'youpin' as const,
    currency: process.env.YOUPIN_PRICES_CURRENCY || 'USD',
    cacheTtlMs: parseInt(process.env.YOUPIN_PRICES_CACHE_TTL_MS || '300000', 10),
  },
};
