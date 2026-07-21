-- Reject the same provider asset being published into more than one listing.
-- The deploy intentionally fails if historical duplicates exist so they can be
-- inspected and restored from the pre-migration backup instead of deleting data.
CREATE UNIQUE INDEX "floats_market_assetId_key" ON "floats"("market", "assetId");

-- Durable state for the active run and the last fully published/successful run.
ALTER TABLE "MarketSyncState" ADD COLUMN "currentPhase" TEXT;
ALTER TABLE "MarketSyncState" ADD COLUMN "targetAssets" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "assetsPerItem" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "totalCandidates" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "currentCandidate" TEXT;
ALTER TABLE "MarketSyncState" ADD COLUMN "quotaUnitsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "quotaLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "quotaResetsAt" DATETIME;
ALTER TABLE "MarketSyncState" ADD COLUMN "completionReason" TEXT;

ALTER TABLE "MarketSyncState" ADD COLUMN "lastPublishedSnapshotHash" TEXT;
ALTER TABLE "MarketSyncState" ADD COLUMN "lastPublishedRawAssetCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "lastPublishedValidAssetCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "lastPublishedSkippedAssetCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "lastPublishedListingCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "lastPublishedFloatCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "lastSuccessfulAt" DATETIME;

-- This feature replaces the disabled competing schedulers with one canonical
-- pipeline. Existing runtime settings used to default both switches to false;
-- enable them once on deploy (the admin can still disable them afterwards).
UPDATE "RuntimeSetting"
SET "value" = 'true', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" IN ('ENABLE_SYNC', 'ENABLE_ITEMS_CATALOG_SYNC');
