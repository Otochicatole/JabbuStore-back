import { MarketSyncState } from "./MarketSyncState";

export interface MarketSyncStateProgress {
  cursorIndex: number;
  lastRowsUsed: number;
  lastCandidatesVisited: number;
  lastError?: string | null;
}

export interface IMarketSyncStateRepository {
  get(key: string): Promise<MarketSyncState | null>;
  markStarted(key: string, queueVersion: string, cursorIndex: number): Promise<void>;
  markFinished(
    key: string,
    queueVersion: string,
    progress: MarketSyncStateProgress,
  ): Promise<void>;
}

