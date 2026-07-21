import {
  MarketAssetsApiError,
  type IMarketAssetsCatalogClient,
  type MarketAssetsCandidatePage,
  type MarketAssetsPageRequest,
} from "../application/IMarketAssetsCatalogClient";
import type { MarketAssetsPriorityCandidate } from "../application/MarketAssetsPriorityQueue";
import { toSteamWebApiPhaseParam } from "../application/floatSyncHelpers";
import type { MarketAssetsCatalogSort } from "../domain/MarketAssetsCatalog";
import {
  STEAM_FLOAT_ASSETS_URL,
  SteamWebApiFloatAssetsClient,
} from "./SteamWebApiFloatAssetsClient";

export interface SteamWebApiMarketAssetsClientOptions {
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Cliente paginado y phase-aware exclusivo para el catálogo global. */
export class SteamWebApiMarketAssetsCatalogClient
  implements IMarketAssetsCatalogClient
{
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly floatClient = new SteamWebApiFloatAssetsClient(),
    options: SteamWebApiMarketAssetsClientOptions = {},
  ) {
    this.maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3));
    this.retryBaseDelayMs = Math.max(
      0,
      Math.trunc(options.retryBaseDelayMs ?? 250),
    );
    this.sleep = options.sleep ?? defaultSleep;
  }

  getSafeSourceUrl(options: {
    limit: number;
    sort: MarketAssetsCatalogSort;
  }): string {
    const params = new URLSearchParams({
      source: "youpin",
      only_market_id: "1",
      with_items: "1",
      limit: String(options.limit),
      offset: "0",
      sort: options.sort,
    });
    return `${STEAM_FLOAT_ASSETS_URL}?${params.toString()}`;
  }

  async fetchCandidatePage(
    candidate: MarketAssetsPriorityCandidate,
    options: MarketAssetsPageRequest,
  ): Promise<MarketAssetsCandidatePage> {
    let quotaUnitsUsed = 0;
    let creditsUsed = 0;
    let lastStatus = 0;
    let lastError = "error desconocido";

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const phaseParam = toSteamWebApiPhaseParam(candidate.phase);
      const phaseQuery: Parameters<
        SteamWebApiFloatAssetsClient["fetchPage"]
      >[0] = {
        // La API admite combinar el nombre exacto con paint/phase/def_index.
        // Mantener este filtro también para Dopplers evita que la consulta de
        // una fase recorra todos los assets que comparten paint_index.
        marketHashName: candidate.queryMarketHashName,
      };
      if (candidate.phase) {
        if (candidate.paintIndex != null) {
          phaseQuery.paintIndex = candidate.paintIndex;
        }
        if (candidate.wear) phaseQuery.wear = candidate.wear;
        if (phaseParam) phaseQuery.phase = phaseParam;
        if (candidate.defIndex != null) phaseQuery.defIndex = candidate.defIndex;
      }

      const result = await this.floatClient.fetchPage({
        source: "youpin",
        onlyMarketId: true,
        withItems: true,
        limit: options.limit,
        offset: options.offset,
        sort: options.sort,
        ...phaseQuery,
        isStatTrak: candidate.isStatTrak,
        isSouvenir: candidate.isSouvenir,
        rateLimitPriority: "sync",
        ...(options.onRateLimitWait
          ? { onRateLimitWait: options.onRateLimitWait }
          : {}),
      });

      quotaUnitsUsed += result.quotaUnitsUsed;
      creditsUsed += result.creditsUsed;
      lastStatus = result.status;
      lastError = result.error ?? `HTTP ${result.status}`;

      if (result.ok) {
        return {
          assets: result.assets,
          providerTotal: result.total,
          limit: result.limit || options.limit,
          offset: result.offset,
          quotaUnitsUsed,
          rowsUsed: quotaUnitsUsed,
          creditsUsed,
        };
      }

      // No existe inventario para esta combinación; no es un fallo global.
      if (result.status === 404) {
        return {
          assets: [],
          providerTotal: 0,
          limit: options.limit,
          offset: options.offset,
          quotaUnitsUsed,
          rowsUsed: quotaUnitsUsed,
          creditsUsed,
        };
      }

      // El collector debe persistir el checkpoint antes de dormir una ventana.
      // El siguiente intento pasará por el limitador ya penalizado y esperará
      // hasta Retry-After/reset sin volver a consumir cuota anticipadamente.
      if (result.status === 429) {
        throw new MarketAssetsApiError(
          `SteamWebAPI agotó la cuota al consultar "${candidate.marketHashName}": ${lastError}`,
          "retryable",
          429,
          quotaUnitsUsed,
          creditsUsed,
        );
      }

      const fatal =
        result.status === 401 ||
        result.status === 402 ||
        result.status === 403 ||
        lastError.includes("API_KEY no configurado");
      if (fatal) {
        throw new MarketAssetsApiError(
          `SteamWebAPI rechazó la configuración al consultar "${candidate.marketHashName}": ${lastError}`,
          "fatal",
          result.status,
          quotaUnitsUsed,
          creditsUsed,
        );
      }

      const retryable =
        result.rateLimited ||
        result.status === 0 ||
        result.status === 408 ||
        result.status === 425 ||
        result.status >= 500;
      if (!retryable) {
        throw new MarketAssetsApiError(
          `SteamWebAPI rechazó el contrato para "${candidate.marketHashName}" (HTTP ${result.status}): ${lastError}`,
          // Sólo un 404 comprobado equivale a listing agotada. Un 4xx distinto
          // puede ser un cambio global del contrato; publicar como catálogo
          // agotado en ese caso borraría listings válidos.
          "fatal",
          result.status,
          quotaUnitsUsed,
          creditsUsed,
        );
      }

      if (attempt < this.maxAttempts && this.retryBaseDelayMs > 0) {
        await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }

    throw new MarketAssetsApiError(
      `No se pudo consultar "${candidate.marketHashName}" después de ${this.maxAttempts} intentos (HTTP ${lastStatus}): ${lastError}`,
      "retryable",
      lastStatus,
      quotaUnitsUsed,
      creditsUsed,
    );
  }
}
