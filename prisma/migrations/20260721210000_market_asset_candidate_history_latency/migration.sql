-- Coste de la última observación de disponibilidad confirmada del candidato.
-- Los errores transitorios se registran en MarketSyncRun y no sobrescriben este hint.
ALTER TABLE "MarketAssetCandidateHistory" ADD COLUMN "latencyMs" INTEGER NOT NULL DEFAULT 0;
