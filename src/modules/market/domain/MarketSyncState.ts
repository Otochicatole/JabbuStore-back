export interface MarketSyncState {
  key: string;
  queueVersion: string;
  cursorIndex: number;
  lastRowsUsed: number;
  lastCandidatesVisited: number;
  lastError: string | null;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

