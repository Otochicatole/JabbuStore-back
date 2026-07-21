import { prisma } from "../../../shared/infrastructure/PrismaClient";
import type {
  IMarketAssetCandidateHistoryRepository,
  MarketAssetCandidateHistoryObservation,
  MarketAssetCandidateHistoryRecord,
  MarketAssetCandidateOutcome,
} from "../domain/IMarketAssetCandidateHistoryRepository";

function toRecord(row: {
  candidateKey: string;
  runId: string | null;
  queueVersion: string;
  marketHashName: string;
  outcome: string;
  providerTotal: number;
  rawAssetCount: number;
  validAssetCount: number;
  skippedAssetCount: number;
  pageRequests: number;
  httpAttempts: number;
  latencyMs?: number;
  lastOffset: number;
  effectiveConcurrency: number | null;
  errorStatus: number | null;
  errorMessage: string | null;
  observedAt: Date;
}): MarketAssetCandidateHistoryRecord {
  return {
    ...row,
    latencyMs: row.latencyMs ?? 0,
    outcome: row.outcome as MarketAssetCandidateOutcome,
  };
}

function observationData(
  runId: string | null,
  observation: MarketAssetCandidateHistoryObservation,
) {
  const latencyMs =
    observation.latencyMs != null && Number.isFinite(observation.latencyMs)
      ? Math.max(0, Math.trunc(observation.latencyMs))
      : 0;
  return {
    runId,
    queueVersion: observation.queueVersion,
    marketHashName: observation.marketHashName,
    outcome: observation.outcome,
    providerTotal: observation.providerTotal ?? 0,
    rawAssetCount: observation.rawAssetCount ?? 0,
    validAssetCount: observation.validAssetCount ?? 0,
    skippedAssetCount: observation.skippedAssetCount ?? 0,
    pageRequests: observation.pageRequests ?? 0,
    httpAttempts: observation.httpAttempts ?? 0,
    latencyMs,
    lastOffset: observation.lastOffset ?? 0,
    effectiveConcurrency: observation.effectiveConcurrency ?? null,
    errorStatus: observation.errorStatus ?? null,
    errorMessage: observation.errorMessage ?? null,
    observedAt: observation.observedAt ?? new Date(),
  };
}

export class PrismaMarketAssetCandidateHistoryRepository
  implements IMarketAssetCandidateHistoryRepository
{
  async getByCandidateKeys(
    candidateKeys: readonly string[],
  ): Promise<MarketAssetCandidateHistoryRecord[]> {
    const uniqueKeys = [...new Set(candidateKeys.filter(Boolean))];
    if (uniqueKeys.length === 0) return [];

    const rows = await prisma.marketAssetCandidateHistory.findMany({
      where: { candidateKey: { in: uniqueKeys } },
    });
    return rows.map(toRecord);
  }

  async recordObservations(
    runId: string | null,
    observations: readonly MarketAssetCandidateHistoryObservation[],
  ): Promise<void> {
    if (observations.length === 0) return;

    // La cola puede informar el mismo candidato mas de una vez en un lote.
    // Conservar solamente la observacion mas reciente hace el upsert determinista.
    const latest = new Map<string, MarketAssetCandidateHistoryObservation>();
    for (const observation of observations) {
      // Errores de transporte/autorizacion no describen disponibilidad. Nunca
      // deben reemplazar un hint confirmado que la cola puede reutilizar.
      if (
        observation.outcome === "transient_error" ||
        observation.outcome === "fatal_error"
      ) {
        continue;
      }
      const current = latest.get(observation.candidateKey);
      if (
        !current ||
        (observation.observedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) >=
          (current.observedAt?.getTime() ?? 0)
      ) {
        latest.set(observation.candidateKey, observation);
      }
    }
    if (latest.size === 0) return;

    await prisma.$transaction(
      [...latest.values()].map((observation) => {
        const data = observationData(runId, observation);
        return prisma.marketAssetCandidateHistory.upsert({
          where: { candidateKey: observation.candidateKey },
          create: { candidateKey: observation.candidateKey, ...data },
          update: data,
        });
      }),
    );
  }

  async prune(staleBefore = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000)) {
    const result = await prisma.marketAssetCandidateHistory.deleteMany({
      where: { observedAt: { lt: staleBefore } },
    });
    return result.count;
  }
}
