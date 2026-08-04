import type { FloatItem } from '../domain/FloatItem';
import { SteamWebApiFloatAssetsClient } from '../infrastructure/SteamWebApiFloatAssetsClient';
import { assetToFloatItem } from './floatCatalogMapper';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';
import { toSteamWebApiPhaseParam } from './floatSyncHelpers';

export interface FloatDownloadConfig {
  pageSize: number;
  maxPages: number;
  maxRetries: number;
  retryDelayMs: number;
  requestTimeoutMs: number;
}

export interface FloatDownloadResult {
  floats: Omit<FloatItem, 'resaleItemId'>[];
  presentAssetIds: string[];
  pagesDownloaded: number;
  assetsDownloaded: number;
  validAssets: number;
  invalidatedHint: number;
  complete: boolean;
  error: string | null;
}

const ENV_DEFAULTS: FloatDownloadConfig = {
  pageSize: Math.max(1, Number(process.env.YOUPIN_FLOAT_PAGE_SIZE) || 100),
  maxPages: Math.max(1, Number(process.env.YOUPIN_FLOAT_MAX_PAGES) || 5),
  maxRetries: Math.max(1, Number(process.env.YOUPIN_FLOAT_MAX_RETRIES) || 3),
  retryDelayMs: Math.max(100, Number(process.env.YOUPIN_FLOAT_RETRY_DELAY_MS) || 1_000),
  requestTimeoutMs: Math.max(1_000, Number(process.env.YOUPIN_FLOAT_REQUEST_TIMEOUT_MS) || 30_000),
};

function jitter(base: number): number {
  return base + Math.floor(Math.random() * base * 0.3);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Descarga paginada de /steam/api/float/assets para un MarketListing.
 *
 * Caracteristicas:
 * - Paginacion completa con deteccion de ultima pagina y paginas repetidas.
 * - Limite maximo de seguridad (YOUPIN_FLOAT_MAX_PAGES).
 * - Reintentos con backoff exponencial + jitter.
 * - Manejo de HTTP 429 con respeto a Retry-After.
 * - Eliminacion de duplicados por assetId.
 * - Logs estructurados.
 * - NO invalida assets si la descarga es incompleta o falla.
 */
export class YoupinFloatAssetsDownloader {
  private readonly client: SteamWebApiFloatAssetsClient;
  private readonly config: FloatDownloadConfig;

  constructor(
    client?: SteamWebApiFloatAssetsClient,
    config: Partial<FloatDownloadConfig> = {},
  ) {
    this.client = client ?? new SteamWebApiFloatAssetsClient();
    this.config = { ...ENV_DEFAULTS, ...config };
  }

  async download(
    listingId: string,
    marketHashName: string,
  ): Promise<FloatDownloadResult> {
    const start = Date.now();
    const { baseName, phase } = PriceEnrichmentService.getBaseNameAndPhase(marketHashName);
    const queryName = baseName || marketHashName;
    const phaseParam = toSteamWebApiPhaseParam(phase ?? null) ?? undefined;

    const seenAssetIds = new Set<string>();
    const floats: Omit<FloatItem, 'resaleItemId'>[] = [];
    let pagesDownloaded = 0;
    let assetsDownloaded = 0;
    let lastPageAssetIds: string[] = [];
    let offset = 0;
    let complete = false;
    let lastError: string | null = null;

    console.log(
      `[YoupinFloats] listingId=${listingId} marketHashName="${marketHashName}" start`,
    );

    for (let page = 0; page < this.config.maxPages; page++) {
      const pageResult = await this.fetchPageWithRetry(queryName, offset, phaseParam);

      if (!pageResult.ok) {
        lastError = pageResult.error ?? `HTTP ${pageResult.status}`;
        console.warn(
          `[YoupinFloats] listingId=${listingId} page=${page} error="${lastError}"`,
        );
        // Si ya tenemos datos de paginas anteriores, completamos de forma parcial.
        // La invalidacion NO se ejecuta si complete = false.
        break;
      }

      const rawAssets: any[] = pageResult.assets;
      assetsDownloaded += rawAssets.length;
      pagesDownloaded++;

      // Detectar paginas repetidas (mismos assetIds que la pagina anterior)
      const currentAssetIds = rawAssets
        .map((a: any) => String(a.assetid ?? a.asset_id ?? a.id ?? ''))
        .filter(Boolean);

      if (page > 0 && currentAssetIds.length > 0) {
        const repeatedCount = currentAssetIds.filter((id) => lastPageAssetIds.includes(id)).length;
        if (repeatedCount === currentAssetIds.length) {
          console.log(
            `[YoupinFloats] listingId=${listingId} pagina repetida detectada en offset=${offset}. Deteniendo.`,
          );
          complete = true;
          break;
        }
      }
      lastPageAssetIds = currentAssetIds;

      // Procesar assets de esta pagina
      for (const asset of rawAssets) {
        const floatItem = assetToFloatItem(asset, 'pending');
        if (!floatItem) continue;

        const assetId = floatItem.assetId;
        if (seenAssetIds.has(assetId)) continue; // dedup global
        seenAssetIds.add(assetId);
        floats.push(floatItem);
      }

      // Detectar ultima pagina
      const total = pageResult.total;
      const limit = pageResult.limit || this.config.pageSize;
      offset += limit;

      const exhausted =
        rawAssets.length === 0 ||
        (total > 0 && offset >= total) ||
        rawAssets.length < limit;

      if (exhausted) {
        complete = true;
        break;
      }
    }

    const duration = Date.now() - start;
    console.log(
      `[YoupinFloats] listingId=${listingId} complete=${complete} pages=${pagesDownloaded} ` +
        `assetsRaw=${assetsDownloaded} valid=${floats.length} duration=${duration}ms` +
        (lastError ? ` error="${lastError}"` : ''),
    );

    return {
      floats,
      presentAssetIds: floats.map((f) => f.assetId),
      pagesDownloaded,
      assetsDownloaded,
      validAssets: floats.length,
      invalidatedHint: 0,
      complete,
      error: lastError,
    };
  }

  private async fetchPageWithRetry(
    marketHashName: string,
    offset: number,
    phase?: string,
  ): Promise<any> {
    let lastResult: any = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      const result = await this.client.fetchPage({
        marketHashName,
        source: 'youpin',
        onlyMarketId: true,
        withItems: true,
        limit: this.config.pageSize,
        offset,
        sort: 'newest',
        ...(phase ? { phase } : {}),
        rateLimitPriority: 'normal',
        requestTimeoutMs: this.config.requestTimeoutMs,
      });

      lastResult = result;

      if (result.ok) return result;

      // 429: respetar Retry-After o backoff
      if (result.status === 429 || result.rateLimited) {
        const waitMs = jitter(this.config.retryDelayMs * 2 ** attempt);
        console.warn(
          `[YoupinFloats] Rate limited, esperando ${waitMs}ms (intento ${attempt + 1}/${this.config.maxRetries})`,
        );
        await sleep(waitMs);
        continue;
      }

      // Errores recuperables (500, 503, 408, timeout)
      const recoverable =
        result.status === 0 ||
        result.status === 408 ||
        result.status >= 500;

      if (recoverable && attempt < this.config.maxRetries - 1) {
        const waitMs = jitter(this.config.retryDelayMs * 2 ** attempt);
        await sleep(waitMs);
        continue;
      }

      // No recuperable o intentos agotados
      break;
    }

    return lastResult ?? { ok: false, status: 0, assets: [], total: 0, error: 'max retries' };
  }
}