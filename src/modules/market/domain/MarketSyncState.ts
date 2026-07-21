import type { MarketSyncCompletionReason } from "./IMarketSyncStateRepository";

export interface MarketSyncState {
  key: string;
  queueVersion: string;
  cursorIndex: number;
  lastRowsUsed: number;
  lastCandidatesVisited: number;
  lastError: string | null;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;

  snapshotHash: string | null;
  rawAssetCount: number;
  validAssetCount: number;
  skippedAssetCount: number;
  publishedListingCount: number;
  publishedFloatCount: number;
  lastDownloadedAt: Date | null;
  lastPublishedAt: Date | null;

  currentPhase: string | null;
  targetAssets: number;
  assetsPerItem: number;
  totalCandidates: number;
  currentCandidate: string | null;
  quotaUnitsUsed: number;
  quotaLimit: number;
  quotaResetsAt: Date | null;
  completionReason: MarketSyncCompletionReason | null;

  lastPublishedSnapshotHash: string | null;
  lastPublishedRawAssetCount: number;
  lastPublishedValidAssetCount: number;
  lastPublishedSkippedAssetCount: number;
  lastPublishedListingCount: number;
  lastPublishedFloatCount: number;
  lastSuccessfulAt: Date | null;
  activeRunId: string | null;
  lastRunId: string | null;

  createdAt: Date;
  updatedAt: Date;
}
