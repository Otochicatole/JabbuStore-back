-- DropTable
PRAGMA foreign_keys=OFF;
DROP TABLE IF EXISTS "ParticipationDrawEntry";
DROP TABLE IF EXISTS "ParticipationDraw";

-- CreateTable
CREATE TABLE "ParticipationDraw" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minRaffles" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ParticipationDrawPrize" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drawId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "iconUrl" TEXT,
    "rarity" TEXT,
    "exterior" TEXT,
    "float" REAL,
    "pattern" INTEGER,
    "provider" TEXT NOT NULL,
    "winnerId" TEXT,
    CONSTRAINT "ParticipationDrawPrize_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "ParticipationDraw" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParticipationDrawPrize_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ParticipationDrawEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drawId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "raffleCount" INTEGER NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ParticipationDrawEntry_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "ParticipationDraw" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParticipationDrawEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ParticipationDraw_status_idx" ON "ParticipationDraw"("status");

-- CreateIndex
CREATE INDEX "ParticipationDraw_isPublic_status_idx" ON "ParticipationDraw"("isPublic", "status");

-- CreateIndex
CREATE INDEX "ParticipationDrawPrize_drawId_idx" ON "ParticipationDrawPrize"("drawId");

-- CreateIndex
CREATE INDEX "ParticipationDrawPrize_winnerId_idx" ON "ParticipationDrawPrize"("winnerId");

-- CreateIndex
CREATE INDEX "ParticipationDrawEntry_drawId_idx" ON "ParticipationDrawEntry"("drawId");

-- CreateIndex
CREATE INDEX "ParticipationDrawEntry_userId_idx" ON "ParticipationDrawEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationDrawEntry_drawId_userId_key" ON "ParticipationDrawEntry"("drawId", "userId");

PRAGMA foreign_keys=ON;
