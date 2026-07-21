-- Add durable metadata for the downloaded and published market-assets snapshot.
-- This migration was already applied to the original SQLite database; restoring
-- the file makes fresh deployments and `prisma migrate deploy` reproducible.
ALTER TABLE "MarketSyncState" ADD COLUMN "snapshotHash" TEXT;
ALTER TABLE "MarketSyncState" ADD COLUMN "rawAssetCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "validAssetCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "skippedAssetCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "publishedListingCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "publishedFloatCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSyncState" ADD COLUMN "lastDownloadedAt" DATETIME;
ALTER TABLE "MarketSyncState" ADD COLUMN "lastPublishedAt" DATETIME;
