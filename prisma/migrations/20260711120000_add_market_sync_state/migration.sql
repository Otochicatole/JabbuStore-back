CREATE TABLE "MarketSyncState" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "queueVersion" TEXT NOT NULL,
  "cursorIndex" INTEGER NOT NULL DEFAULT 0,
  "lastRowsUsed" INTEGER NOT NULL DEFAULT 0,
  "lastCandidatesVisited" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lastStartedAt" DATETIME,
  "lastFinishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
