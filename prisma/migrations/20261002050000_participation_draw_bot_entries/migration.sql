-- CreateTable
CREATE TABLE "ParticipationDrawBotEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drawId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chances" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ParticipationDrawBotEntry_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "ParticipationDraw" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParticipationDrawBotEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ParticipationDrawBotEntry_drawId_idx" ON "ParticipationDrawBotEntry"("drawId");

-- CreateIndex
CREATE INDEX "ParticipationDrawBotEntry_userId_idx" ON "ParticipationDrawBotEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationDrawBotEntry_drawId_userId_key" ON "ParticipationDrawBotEntry"("drawId", "userId");
