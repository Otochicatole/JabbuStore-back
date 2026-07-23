import type { MarketAssetsPriorityCandidate } from "./MarketAssetsPriorityQueue";
import type { MarketAssetsCatalogSort } from "../domain/MarketAssetsCatalog";

export type MarketAssetsRequestOutcome =
  | "success"
  | "success_empty"
  | "not_found"
  | "timeout"
  | "network"
  | "http_transient"
  | "cancelled"
  | "fatal"
  | "rate_limited";

export interface MarketAssetsCandidatePage {
  assets: unknown[];
  providerTotal: number;
  limit: number;
  offset: number;
  /** Unidades reservadas de la cuota de assets (incluye reintentos). */
  quotaUnitsUsed: number;
  /** Alias histórico para métricas existentes. */
  rowsUsed: number;
  creditsUsed: number;
  /** Intentos HTTP reales; los reintentos se coordinan fuera del cliente. */
  httpAttempts?: number;
  notFound?: boolean;
  durationMs?: number;
  outcome?: Extract<
    MarketAssetsRequestOutcome,
    "success" | "success_empty" | "not_found"
  >;
}

export interface MarketAssetsPageRequest {
  limit: number;
  offset: number;
  sort: MarketAssetsCatalogSort;
  signal?: AbortSignal;
  onRateLimitWait?: (waitMs: number) => void;
}

export interface IMarketAssetsCatalogClient {
  getSafeSourceUrl(options: {
    limit: number;
    sort: MarketAssetsCatalogSort;
  }): string;
  fetchCandidatePage(
    candidate: MarketAssetsPriorityCandidate,
    options: MarketAssetsPageRequest,
  ): Promise<MarketAssetsCandidatePage>;
}

export type MarketAssetsApiErrorKind =
  | "fatal"
  | "retryable"
  | "candidate";

/** Error tipado que conserva la cuota consumida aun cuando la página falla. */
export class MarketAssetsApiError extends Error {
  constructor(
    message: string,
    readonly kind: MarketAssetsApiErrorKind,
    readonly status: number,
    readonly quotaUnitsUsed: number,
    readonly creditsUsed = 0,
    readonly httpAttempts = 1,
    readonly durationMs = 0,
    readonly failureKind: Exclude<
      MarketAssetsRequestOutcome,
      "success" | "success_empty" | "not_found"
    > = kind === "fatal" ? "fatal" : status === 429 ? "rate_limited" : "network",
  ) {
    super(message);
    this.name = "MarketAssetsApiError";
  }
}
