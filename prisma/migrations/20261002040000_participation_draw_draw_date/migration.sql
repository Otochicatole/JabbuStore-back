-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ParticipationDraw" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minRaffles" INTEGER NOT NULL,
    "drawDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ParticipationDraw" ("id", "name", "description", "minRaffles", "drawDate", "status", "isPublic", "createdAt", "updatedAt")
SELECT "id", "name", "description", "minRaffles", datetime('now', '+1 day'), "status", "isPublic", "createdAt", "updatedAt" FROM "ParticipationDraw";
DROP TABLE "ParticipationDraw";
ALTER TABLE "new_ParticipationDraw" RENAME TO "ParticipationDraw";
CREATE INDEX "ParticipationDraw_status_idx" ON "ParticipationDraw"("status");
CREATE INDEX "ParticipationDraw_isPublic_status_idx" ON "ParticipationDraw"("isPublic", "status");
CREATE INDEX "ParticipationDraw_status_drawDate_idx" ON "ParticipationDraw"("status", "drawDate");
PRAGMA foreign_keys=ON;
