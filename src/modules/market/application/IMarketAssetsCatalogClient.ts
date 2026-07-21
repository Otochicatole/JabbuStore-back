import type { MarketAssetsPriorityCandidate } from "./MarketAssetsPriorityQueue";
import type { MarketAssetsCatalogSort } from "../domain/MarketAssetsCatalog";

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
}

export interface MarketAssetsPageRequest {
  limit: number;
  offset: number;
  sort: MarketAssetsCatalogSort;
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
  ) {
    super(message);
    this.name = "MarketAssetsApiError";
  }
}
