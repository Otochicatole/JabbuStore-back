-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ParticipationDrawPrize" (
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
    "scheduledWinnerId" TEXT,
    CONSTRAINT "ParticipationDrawPrize_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "ParticipationDraw" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParticipationDrawPrize_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ParticipationDrawPrize_scheduledWinnerId_fkey" FOREIGN KEY ("scheduledWinnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ParticipationDrawPrize" ("assetId", "drawId", "exterior", "float", "iconUrl", "id", "name", "pattern", "position", "price", "provider", "rarity", "winnerId") SELECT "assetId", "drawId", "exterior", "float", "iconUrl", "id", "name", "pattern", "position", "price", "provider", "rarity", "winnerId" FROM "ParticipationDrawPrize";
DROP TABLE "ParticipationDrawPrize";
ALTER TABLE "new_ParticipationDrawPrize" RENAME TO "ParticipationDrawPrize";
CREATE INDEX "ParticipationDrawPrize_drawId_idx" ON "ParticipationDrawPrize"("drawId");
CREATE INDEX "ParticipationDrawPrize_winnerId_idx" ON "ParticipationDrawPrize"("winnerId");
CREATE INDEX "ParticipationDrawPrize_scheduledWinnerId_idx" ON "ParticipationDrawPrize"("scheduledWinnerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
