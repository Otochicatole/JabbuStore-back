import type { MarketSyncState } from "./MarketSyncState";

export type MarketSyncCompletionReason =
  | "target_reached"
  | "catalog_exhausted";

export interface MarketSnapshotCounts {
  snapshotHash: string;
  rawAssetCount: number;
  validAssetCount: number;
  skippedAssetCount: number;
  completionReason?: MarketSyncCompletionReason | null;
}

export interface MarketCollectionProgress {
  cursorIndex: number;
  rowsUsed: number;
  candidatesVisited: number;
  rawAssetCount: number;
  validAssetCount: number;
  skippedAssetCount: number;
  totalCandidates?: number;
  currentCandidate?: string | null;
  targetAssets?: number;
  assetsPerItem?: number;
  quotaUnitsUsed?: number;
  quotaLimit?: number;
  quotaResetsAt?: Date | null;
  phase?: string;
}

export interface MarketSyncStartOptions {
  phase?: string;
  targetAssets?: number;
  assetsPerItem?: number;
  quotaLimit?: number;
}

export interface MarketSyncCurrentStatusUpdate {
  phase?: string | null;
  cursorIndex?: number;
  rowsUsed?: number;
  candidatesVisited?: number;
  totalCandidates?: number;
  currentCandidate?: string | null;
  rawAssetCount?: number;
  validAssetCount?: number;
  skippedAssetCount?: number;
  quotaUnitsUsed?: number;
  quotaLimit?: number;
  quotaResetsAt?: Date | null;
  completionReason?: MarketSyncCompletionReason | null;
  error?: string | null;
}

/** Legacy progress payload retained for the incremental sync during migration. */
export interface MarketSyncStateProgress {
  cursorIndex: number;
  lastRowsUsed: number;
  lastCandidatesVisited: number;
  lastError?: string | null;
}

export interface IMarketSyncStateRepository {
  get(key: string): Promise<MarketSyncState | null>;

  /**
   * Starts a durable run. Optional legacy arguments keep the previous incremental
   * synchronizer source-compatible while the atomic pipeline becomes canonical.
   */
  markStarted(
    key: string,
    queueVersion?: string,
    cursorIndex?: number,
    options?: MarketSyncStartOptions,
  ): Promise<void>;

  markCollectionProgress(
    key: string,
    queueVersion: string,
    progress: MarketCollectionProgress,
  ): Promise<void>;
  updateCurrentStatus(
    key: string,
    update: MarketSyncCurrentStatusUpdate,
  ): Promise<void>;
  markSnapshotSaved(key: string, counts: MarketSnapshotCounts): Promise<void>;
  markPublished(
    key: string,
    counts: MarketSnapshotCounts,
    published: { listings: number; floats: number },
  ): Promise<void>;
  /** Se llama cuando la publicación transaccional del snapshot de assets terminó. */
  markFullSuccess(key: string): Promise<void>;
  markFailed(key: string, error: string): Promise<void>;

  /** Legacy incremental-sync completion method. */
  markFinished(
    key: string,
    queueVersion: string,
    progress: MarketSyncStateProgress,
  ): Promise<void>;
}
