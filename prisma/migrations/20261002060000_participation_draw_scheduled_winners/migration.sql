-- AlterTable
ALTER TABLE "ParticipationDrawPrize" ADD COLUMN "scheduledWinnerId" TEXT;

-- CreateIndex
CREATE INDEX "ParticipationDrawPrize_scheduledWinnerId_idx" ON "ParticipationDrawPrize"("scheduledWinnerId");
