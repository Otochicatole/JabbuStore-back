-- These columns were added to schema.prisma and local development databases
-- without a Prisma migration. Production databases created from migrations
-- therefore lacked them and every Prisma User/AdminSettings query could fail.
ALTER TABLE "User" ADD COLUMN "isFake" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AdminSettings" ADD COLUMN "homeStatsActiveUsers" TEXT NOT NULL DEFAULT '150K+';
ALTER TABLE "AdminSettings" ADD COLUMN "homeStatsAvailableSkins" TEXT NOT NULL DEFAULT '45K+';
ALTER TABLE "AdminSettings" ADD COLUMN "homeStatsTransactions" TEXT NOT NULL DEFAULT '2.5M+';
ALTER TABLE "AdminSettings" ADD COLUMN "homeStatsOnlineSupport" TEXT NOT NULL DEFAULT '24/7';

ALTER TABLE "Order" ADD COLUMN "botId" TEXT REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
