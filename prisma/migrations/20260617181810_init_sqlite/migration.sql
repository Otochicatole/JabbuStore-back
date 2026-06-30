-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "name" TEXT,
    "password" TEXT,
    "steamId" TEXT,
    "avatar" TEXT,
    "profileUrl" TEXT,
    "tradeUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StoreItem" (
    "assetId" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "iconUrl" TEXT,
    "tradable" BOOLEAN NOT NULL DEFAULT true,
    "marketable" BOOLEAN NOT NULL DEFAULT true,
    "botSteamId" TEXT NOT NULL,
    "price" REAL NOT NULL DEFAULT 0.0,
    "isPriceManual" BOOLEAN NOT NULL DEFAULT false,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "exterior" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "isStatTrak" BOOLEAN NOT NULL DEFAULT false,
    "isSouvenir" BOOLEAN NOT NULL DEFAULT false,
    "float" REAL,
    "pattern" INTEGER,
    "inspectLink" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "youpinAsk" REAL,
    "youpinVolume" INTEGER,
    "price" REAL NOT NULL DEFAULT 0.0,
    "iconUrl" TEXT,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "exterior" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "isStatTrak" BOOLEAN NOT NULL DEFAULT false,
    "isSouvenir" BOOLEAN NOT NULL DEFAULT false,
    "isPriceManual" BOOLEAN NOT NULL DEFAULT false,
    "floatsSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserInventoryItem" (
    "assetId" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "iconUrl" TEXT,
    "tradable" BOOLEAN NOT NULL DEFAULT true,
    "marketable" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "price" REAL NOT NULL DEFAULT 0.0,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "exterior" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "isStatTrak" BOOLEAN NOT NULL DEFAULT false,
    "isSouvenir" BOOLEAN NOT NULL DEFAULT false,
    "float" REAL,
    "pattern" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserInventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "totalPrice" REAL NOT NULL,
    "paymentMethod" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "iconUrl" TEXT,
    "rarity" TEXT,
    "exterior" TEXT,
    "float" REAL,
    "pattern" INTEGER,
    "provider" TEXT,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdminSettings" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Bot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "steamId" TEXT NOT NULL,
    "tradeUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "maxItems" INTEGER NOT NULL DEFAULT 1000,
    "currentItems" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" DATETIME,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SkinListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "botId" TEXT,
    "skinId" TEXT NOT NULL,
    "basePrice" REAL NOT NULL,
    "finalPrice" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reservedByUserId" TEXT,
    "reservedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkinListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SkinListing_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyerId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "skinId" TEXT NOT NULL,
    "botId" TEXT,
    "basePrice" REAL NOT NULL,
    "finalPrice" REAL NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending_payment',
    "tradeStatus" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Purchase_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Purchase_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "SkinListing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Purchase_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "steamTradeOfferId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "sentAt" DATETIME,
    "acceptedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trade_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trade_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "floats" (
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
    "resaleItemId" TEXT NOT NULL,
    CONSTRAINT "floats_resaleItemId_fkey" FOREIGN KEY ("resaleItemId") REFERENCES "MarketListing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_steamId_key" ON "User"("steamId");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_username_key" ON "Admin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MarketListing_name_key" ON "MarketListing"("name");

-- CreateIndex
CREATE INDEX "MarketListing_exterior_floatsSyncedAt_idx" ON "MarketListing"("exterior", "floatsSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bot_steamId_key" ON "Bot"("steamId");
