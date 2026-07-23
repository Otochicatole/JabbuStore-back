import {
  MarketAssetsApiError,
  type IMarketAssetsCatalogClient,
  type MarketAssetsCandidatePage,
  type MarketAssetsPageRequest,
} from "../application/IMarketAssetsCatalogClient";
import type { MarketAssetsPriorityCandidate } from "../application/MarketAssetsPriorityQueue";
import type { MarketAssetsCatalogSort } from "../domain/MarketAssetsCatalog";
import {
  MarketAssetRequestPacer,
  type MarketAssetRequestPacerOutcome,
  type MarketAssetRequestPacerSnapshot,
} from "../application/MarketAssetRequestPacer";
import {
  STEAM_FLOAT_ASSETS_URL,
  SteamWebApiFloatAssetsClient,
} from "./SteamWebApiFloatAssetsClient";

/** Cliente paginado y phase-aware exclusivo para el catálogo global. */
export class SteamWebApiMarketAssetsCatalogClient
  implements IMarketAssetsCatalogClient
{
  constructor(
    private readonly floatClient = new SteamWebApiFloatAssetsClient(),
    private readonly requestPacer: MarketAssetRequestPacer | null = null,
  ) {}

  resetRequestPacing(): void {
    this.requestPacer?.reset();
  }

  getRequestPacerSnapshot(): MarketAssetRequestPacerSnapshot | null {
    return this.requestPacer?.getSnapshot() ?? null;
  }

  getSafeSourceUrl(options: {
    limit: number;
    sort: MarketAssetsCatalogSort;
  }): string {
    const params = new URLSearchParams({
      source: "youpin",
      only_market_id: "1",
      with_items: "0",
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
    const phaseQuery: Parameters<
      SteamWebApiFloatAssetsClient["fetchPage"]
    >[0] = {
      marketHashName: candidate.queryMarketHashName,
    };
    if (candidate.phase) {
      // `paint_index` ya identifica la fase. SteamWebAPI devuelve total=0 si
      // además se envía `phase`, por lo que ese filtro redundante se omite.
      if (candidate.paintIndex != null) {
        phaseQuery.paintIndex = candidate.paintIndex;
      }
      if (candidate.wear) phaseQuery.wear = candidate.wear;
      if (candidate.defIndex != null) phaseQuery.defIndex = candidate.defIndex;
    }

    const result = await this.floatClient.fetchPage({
      source: "youpin",
      onlyMarketId: true,
      // El catálogo aporta la imagen exacta. Sólo se solicita el objeto item
      // como fallback para filas antiguas/incompletas que no traen imagen.
      withItems: !candidate.catalogImageUrl,
      limit: options.limit,
      offset: options.offset,
      sort: options.sort,
      ...phaseQuery,
      isStatTrak: candidate.isStatTrak,
      isSouvenir: candidate.isSouvenir,
      rateLimitPriority: "sync",
      ...(this.requestPacer
        ? {
            beforePhysicalRequest: () =>
              this.requestPacer!.acquire(options.signal),
          }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onRateLimitWait
        ? { onRateLimitWait: options.onRateLimitWait }
        : {}),
    });
    this.observeRequestPacer(result);

    const quotaUnitsUsed = result.quotaUnitsUsed;
    const creditsUsed = result.creditsUsed;
    const lastError = result.error ?? `HTTP ${result.status}`;

    if (result.ok) {
      return {
        assets: result.assets,
        providerTotal: result.total,
        limit: result.limit || options.limit,
        offset: result.offset,
        quotaUnitsUsed,
        rowsUsed: quotaUnitsUsed,
        creditsUsed,
        httpAttempts: result.httpAttempts,
        notFound: false,
        durationMs: result.durationMs,
        outcome:
          result.assets.length > 0 ? "success" : "success_empty",
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
        httpAttempts: result.httpAttempts,
        notFound: true,
        durationMs: result.durationMs,
        outcome: "not_found",
      };
    }

    if (result.status === 429) {
      throw new MarketAssetsApiError(
        `SteamWebAPI agotó la cuota al consultar "${candidate.marketHashName}": ${lastError}`,
        "retryable",
        429,
        quotaUnitsUsed,
        creditsUsed,
        result.httpAttempts,
        result.durationMs,
        "rate_limited",
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
        result.httpAttempts,
        result.durationMs,
        "fatal",
      );
    }

    const retryable =
      result.rateLimited ||
      result.outcome === "timeout" ||
      result.outcome === "cancelled" ||
      result.outcome === "network" ||
      result.outcome === "http_transient" ||
      result.status === 0 ||
      result.status === 408 ||
      result.status === 425 ||
      result.status >= 500;
    if (!retryable) {
      throw new MarketAssetsApiError(
        `SteamWebAPI rechazó el contrato para "${candidate.marketHashName}" (HTTP ${result.status}): ${lastError}`,
        "fatal",
        result.status,
        quotaUnitsUsed,
        creditsUsed,
        result.httpAttempts,
        result.durationMs,
        "fatal",
      );
    }

    throw new MarketAssetsApiError(
      `No se pudo consultar "${candidate.marketHashName}" (HTTP ${result.status}): ${lastError}`,
      "retryable",
      result.status,
      quotaUnitsUsed,
      creditsUsed,
      result.httpAttempts,
      result.durationMs,
      result.outcome === "timeout"
        ? "timeout"
        : result.outcome === "cancelled"
          ? "cancelled"
        : result.outcome === "network"
          ? "network"
          : "http_transient",
    );
  }

  private observeRequestPacer(
    result: Awaited<ReturnType<SteamWebApiFloatAssetsClient["fetchPage"]>>,
  ): void {
    if (!this.requestPacer || result.outcome === "cancelled") return;
    const completedAt = Date.now();
    let outcome: MarketAssetRequestPacerOutcome;
    let resumeAt: number | undefined;
    if (result.status === 429 || result.rateLimited) {
      outcome = "rate_limited";
      resumeAt = Math.max(
        completedAt + 1_000,
        result.rateLimit.cooldownUntil,
        result.rateLimit.windowResetsAt,
      );
    } else if (result.ok || result.status === 404) {
      outcome = "success";
    } else if (
      result.status === 401 ||
      result.status === 402 ||
      result.status === 403 ||
      result.outcome === "fatal"
    ) {
      outcome = "fatal";
    } else if (result.outcome === "timeout") {
      outcome = "timeout";
    } else if (result.outcome === "network" || result.status === 0) {
      outcome = "network_error";
    } else if (
      result.outcome === "http_transient" ||
      result.status >= 500
    ) {
      outcome = "server_error";
    } else {
      outcome = "candidate_error";
    }

    this.requestPacer.observe({
      outcome,
      validAssets: result.ok ? result.assets.length : 0,
      completedAt,
      ...(resumeAt == null ? {} : { resumeAt }),
    });
  }
}
