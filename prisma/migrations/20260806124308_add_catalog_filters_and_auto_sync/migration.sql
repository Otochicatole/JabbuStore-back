/*
  Warnings:

  - You are about to drop the `MarketListing` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MarketSyncState` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `resaleItemId` on the `floats` table. All the data in the column will be lost.
  - Added the required column `listingId` to the `floats` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX IF EXISTS "MarketListing_exterior_floatsSyncedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "MarketListing_name_key";

-- DropTable
DROP TABLE IF EXISTS "MarketListing";

-- DropTable
DROP TABLE IF EXISTS "MarketSyncState";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdminSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "globalPriceModifierType" TEXT NOT NULL DEFAULT 'percentage_increase',
    "globalPriceModifierValue" REAL NOT NULL DEFAULT 0.0,
    "globalPriceModifierEnabled" BOOLEAN NOT NULL DEFAULT false,
    "userSellModifierType" TEXT NOT NULL DEFAULT 'percentage_decrease',
    "userSellModifierValue" REAL NOT NULL DEFAULT 0.0,
    "userSellModifierEnabled" BOOLEAN NOT NULL DEFAULT false,
    "marketModifierType" TEXT NOT NULL DEFAULT 'percentage_increase',
    "marketModifierValue" REAL NOT NULL DEFAULT 0.0,
    "marketModifierEnabled" BOOLEAN NOT NULL DEFAULT false,
    "minimumUserSellPrice" REAL NOT NULL DEFAULT 1.0,
    "webhookUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "usdArsRateKind" TEXT NOT NULL DEFAULT 'blue',
    "mercadoPagoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paypalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "nowpaymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "manualTransferEnabled" BOOLEAN NOT NULL DEFAULT false,
    "manualBankAlias" TEXT,
    "manualBankCbu" TEXT,
    "manualBankHolder" TEXT,
    "manualBankInstructions" TEXT,
    "manualCryptoAddress" TEXT,
    "manualCryptoNetwork" TEXT,
    "manualCryptoInstructions" TEXT,
    "homeStatsActiveUsers" TEXT NOT NULL DEFAULT '150K+',
    "homeStatsAvailableSkins" TEXT NOT NULL DEFAULT '45K+',
    "homeStatsTransactions" TEXT NOT NULL DEFAULT '2.5M+',
    "homeStatsOnlineSupport" TEXT NOT NULL DEFAULT '24/7',
    "catalogFilterKnivesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "catalogFilterGlovesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "catalogFilterRiflesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "catalogFilterPistolsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "catalogFilterSMGsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "catalogFilterHeavyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "catalogFilterSouvenirEnabled" BOOLEAN NOT NULL DEFAULT false,
    "catalogFilterStatTrakEnabled" BOOLEAN NOT NULL DEFAULT true,
    "catalogMinPrice" REAL NOT NULL DEFAULT 0.1,
    "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AdminSettings" ("createdAt", "currency", "globalPriceModifierEnabled", "globalPriceModifierType", "globalPriceModifierValue", "homeStatsActiveUsers", "homeStatsAvailableSkins", "homeStatsOnlineSupport", "homeStatsTransactions", "id", "manualBankAlias", "manualBankCbu", "manualBankHolder", "manualBankInstructions", "manualCryptoAddress", "manualCryptoInstructions", "manualCryptoNetwork", "manualTransferEnabled", "marketModifierEnabled", "marketModifierType", "marketModifierValue", "mercadoPagoEnabled", "minimumUserSellPrice", "nowpaymentsEnabled", "paypalEnabled", "updatedAt", "usdArsRateKind", "userSellModifierEnabled", "userSellModifierType", "userSellModifierValue", "webhookUrl") SELECT "createdAt", "currency", "globalPriceModifierEnabled", "globalPriceModifierType", "globalPriceModifierValue", "homeStatsActiveUsers", "homeStatsAvailableSkins", "homeStatsOnlineSupport", "homeStatsTransactions", "id", "manualBankAlias", "manualBankCbu", "manualBankHolder", "manualBankInstructions", "manualCryptoAddress", "manualCryptoInstructions", "manualCryptoNetwork", "manualTransferEnabled", "marketModifierEnabled", "marketModifierType", "marketModifierValue", "mercadoPagoEnabled", "minimumUserSellPrice", "nowpaymentsEnabled", "paypalEnabled", "updatedAt", "usdArsRateKind", "userSellModifierEnabled", "userSellModifierType", "userSellModifierValue", "webhookUrl" FROM "AdminSettings";
DROP TABLE "AdminSettings";
ALTER TABLE "new_AdminSettings" RENAME TO "AdminSettings";
CREATE TABLE "new_floats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "floatValue" REAL NOT NULL,
    "paintSeed" INTEGER NOT NULL,
    "market" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "inspectLink" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "externalId" TEXT,
    "lastSyncAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listingId" TEXT NOT NULL
);
INSERT INTO "new_floats" ("assetId", "available", "externalId", "floatValue", "id", "inspectLink", "lastSyncAt", "market", "paintSeed", "price") SELECT "assetId", "available", "externalId", "floatValue", "id", "inspectLink", "lastSyncAt", "market", "paintSeed", "price" FROM "floats";
DROP TABLE "floats";
ALTER TABLE "new_floats" RENAME TO "floats";
CREATE INDEX "floats_listingId_idx" ON "floats"("listingId");
CREATE UNIQUE INDEX "floats_market_assetId_key" ON "floats"("market", "assetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
