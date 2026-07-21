export type MarketAssetCandidateOutcome =
  | "available"
  | "empty"
  | "not_found"
  | "transient_error"
  | "fatal_error";

export interface MarketAssetCandidateHistoryObservation {
  candidateKey: string;
  queueVersion: string;
  marketHashName: string;
  outcome: MarketAssetCandidateOutcome;
  providerTotal?: number;
  rawAssetCount?: number;
  validAssetCount?: number;
  skippedAssetCount?: number;
  pageRequests?: number;
  httpAttempts?: number;
  latencyMs?: number;
  lastOffset?: number;
  effectiveConcurrency?: number | null;
  errorStatus?: number | null;
  errorMessage?: string | null;
  observedAt?: Date;
}

export interface MarketAssetCandidateHistoryRecord
  extends Required<
    Pick<
      MarketAssetCandidateHistoryObservation,
      | "candidateKey"
      | "queueVersion"
      | "marketHashName"
      | "outcome"
      | "providerTotal"
      | "rawAssetCount"
      | "validAssetCount"
      | "skippedAssetCount"
      | "pageRequests"
      | "httpAttempts"
      | "latencyMs"
      | "lastOffset"
      | "observedAt"
    >
  > {
  runId: string | null;
  effectiveConcurrency: number | null;
  errorStatus: number | null;
  errorMessage: string | null;
}

export interface IMarketAssetCandidateHistoryRepository {
  getByCandidateKeys(
    candidateKeys: readonly string[],
  ): Promise<MarketAssetCandidateHistoryRecord[]>;
  recordObservations(
    runId: string | null,
    observations: readonly MarketAssetCandidateHistoryObservation[],
  ): Promise<void>;
  prune(staleBefore?: Date): Promise<number>;
}
