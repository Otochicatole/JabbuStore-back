-- The production database already had the raffle tables when this migration
-- was registered, but their CREATE TABLE statements were never committed.
-- Restoring the complete SQL keeps upgrades unchanged (the migration is
-- already marked as applied) and makes a fresh `prisma migrate deploy` viable.
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "drawDate" DATETIME NOT NULL,
    "ticketPrice" REAL NOT NULL,
    "maxTickets" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "RaffleTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raffleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "purchaseDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RaffleTicket_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RaffleTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RaffleTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "RafflePrize" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raffleId" TEXT NOT NULL,
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
    "winningTicketId" TEXT,
    CONSTRAINT "RafflePrize_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RafflePrize_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RafflePrize_winningTicketId_fkey" FOREIGN KEY ("winningTicketId") REFERENCES "RaffleTicket" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
