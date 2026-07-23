import type { IMarketSyncStateRepository } from "../domain/IMarketSyncStateRepository";
import type { IMarketAssetsCatalogStore } from "../domain/MarketAssetsCatalog";
import {
  marketSyncProgressService,
  type MarketSyncCompletionReason,
  type MarketSyncPhase,
  type MarketSyncStatus,
} from "./MarketSyncProgressService";
import { floatRateLimiter } from "./FloatRateLimiter";
import type {
  IMarketSyncRunRepository,
  MarketSyncRunRecord,
  MarketSyncRunStatusView,
} from "../domain/MarketSyncRun";
import { buildMarketSyncRunStatusView } from "./MarketSyncRunStatusView";

export const MARKET_ASSETS_SYNC_STATE_KEY = "youpin-assets-snapshot";

export class GetMarketSyncStatusUseCase {
  constructor(
    private store: IMarketAssetsCatalogStore,
    private syncStateRepository: IMarketSyncStateRepository,
    private syncRunRepository?: IMarketSyncRunRepository,
  ) {}

  async execute(): Promise<MarketSyncStatus> {
    const runtime = marketSyncProgressService.getStatus();
    const [file, checkpoint, state, rateLimit, durableRun] = await Promise.all([
      this.store.getStatus(),
      this.store.getCheckpointStatus(),
      this.syncStateRepository.get(MARKET_ASSETS_SYNC_STATE_KEY),
      floatRateLimiter
        .getDurableSnapshot()
        .catch(() => floatRateLimiter.getSnapshot()),
      this.syncRunRepository?.getCurrentOrLast(MARKET_ASSETS_SYNC_STATE_KEY) ??
        Promise.resolve(null),
    ]);
    const quotaResetsAt = new Date(rateLimit.windowResetsAt).toISOString();
    const workerRuntime = marketSyncProgressService.getWorkerRuntime();
    const workerCheckpoint = checkpoint;
    const buildRunView = (
      runRecord: MarketSyncRunRecord,
      validAssets: number,
      targetAssets: number,
    ): MarketSyncRunStatusView =>
      buildMarketSyncRunStatusView(runRecord, {
        validAssets,
        targetAssets,
        windowQuotaUnitsUsed: rateLimit.quotaUnitsUsed,
        quotaLimit: rateLimit.effectiveCapacity,
        quotaResetsAt,
        workers: {
          initial:
            workerRuntime?.initialConcurrency ??
            workerCheckpoint.initialConcurrency ??
            Math.min(6, runRecord.configuredConcurrency),
          max:
            workerRuntime?.maxConcurrency ??
            workerCheckpoint.concurrency ??
            runRecord.configuredConcurrency,
          effective:
            workerRuntime?.effectiveConcurrency ??
            workerCheckpoint.effectiveConcurrency ??
            runRecord.currentConcurrency,
          required: workerRuntime?.requiredConcurrency,
          inFlight: workerRuntime?.inFlight ?? 0,
          queueDepth: workerRuntime?.queueDepth,
        },
        circuitBreaker:
          workerRuntime?.circuitBreaker ??
          workerCheckpoint.circuitBreaker ?? {
            state: "closed",
            openCount: 0,
            resumeAt: null,
          },
        targetDurationSeconds:
          workerRuntime?.targetDurationSeconds ??
          workerCheckpoint.targetDurationSeconds ??
          600,
        targetDeadlineAt:
          workerRuntime?.targetDeadlineAt ??
          workerCheckpoint.targetDeadlineAt ??
          null,
        tenMinuteTargetUnreachable:
          workerRuntime?.tenMinuteTargetUnreachable ??
          workerCheckpoint.tenMinuteTargetUnreachable ??
          false,
      });

    if (!file.exists && !checkpoint.exists && !state) {
      const run = durableRun
        ? buildRunView(durableRun, runtime.validAssets, runtime.targetAssets)
        : null;
      return {
        ...runtime,
        run,
        lastPublished: null,
        quotaUnitsUsed: rateLimit.quotaUnitsUsed,
        rowsUsed: rateLimit.quotaUnitsUsed,
        quotaLimit: rateLimit.effectiveCapacity,
        quotaResetsAt,
        rateLimitResetsAt: quotaResetsAt,
        lastStartedAt:
          durableRun?.latestAttemptStartedAt.toISOString() ?? runtime.lastStartedAt,
        lastFinishedAt:
          durableRun?.runFinishedAt?.toISOString() ??
          durableRun?.latestAttemptFinishedAt?.toISOString() ??
          runtime.lastFinishedAt,
        itemsCatalog: null,
      };
    }

    const lastPublished = state?.lastPublishedSnapshotHash
      ? {
          snapshotHash: state.lastPublishedSnapshotHash,
          rawAssets: state.lastPublishedRawAssetCount,
          validAssets: state.lastPublishedValidAssetCount,
          skippedAssets: state.lastPublishedSkippedAssetCount,
          publishedListings: state.lastPublishedListingCount,
          publishedFloats: state.lastPublishedFloatCount,
          publishedAt: state.lastPublishedAt?.toISOString() ?? null,
          successfulAt:
            state.lastSuccessfulAt?.toISOString() ??
            state.lastPublishedAt?.toISOString() ??
            null,
          completionReason:
            file.version === state.lastPublishedSnapshotHash
              ? file.completionReason
              : null,
        }
      : null;

    if (runtime.running) {
      const run = durableRun
        ? buildRunView(durableRun, runtime.validAssets, runtime.targetAssets)
        : null;
      return {
        ...runtime,
        run,
        publishedListings: lastPublished?.publishedListings ?? 0,
        publishedFloats: lastPublished?.publishedFloats ?? 0,
        lastPublished,
        quotaUnitsUsed: rateLimit.quotaUnitsUsed,
        rowsUsed: rateLimit.quotaUnitsUsed,
        quotaLimit: rateLimit.effectiveCapacity,
        quotaResetsAt,
        rateLimitResetsAt: quotaResetsAt,
        lastStartedAt:
          durableRun?.latestAttemptStartedAt.toISOString() ?? runtime.lastStartedAt,
        lastFinishedAt:
          durableRun?.runFinishedAt?.toISOString() ??
          durableRun?.latestAttemptFinishedAt?.toISOString() ??
          runtime.lastFinishedAt,
        lastSuccessfulAt:
          state?.lastSuccessfulAt?.toISOString() ?? runtime.lastSuccessfulAt,
        itemsCatalog: null,
      };
    }

    const hasCheckpoint = checkpoint.exists;
    // Tras reiniciar el proceso no existe ejecución en memoria, pero puede
    // quedar una corrida durable `running` si el crash ocurrió antes del primer
    // checkpoint. Se expone como pausa recuperable para que el scheduler la
    // reconcilie de inmediato; startAttempt cerrará la corrida vieja si no hay
    // trabajo compatible y abrirá una nueva.
    const interruptedDurableRun =
      durableRun?.status === "running" && !runtime.running;
    const published = Boolean(
      file.exists &&
        state?.lastPublishedSnapshotHash &&
        state.lastPublishedSnapshotHash === file.version,
    );
    const publicationFinalizationPending = Boolean(
      published &&
        state?.currentPhase !== "syncing_bots" &&
        state?.lastPublishedAt &&
        (!state.lastSuccessfulAt ||
          state.lastPublishedAt.getTime() > state.lastSuccessfulAt.getTime()),
    );
    const publicationPending = Boolean(
      file.exists &&
        file.version &&
        state?.lastPublishedSnapshotHash !== file.version,
    );
    // Versiones anteriores dejaban la publicación de assets en syncing_bots.
    // Para este status eso ya es un éxito de assets, aunque el bot job antiguo
    // haya escrito un error después.
    const legacyPublishedAssets = Boolean(
      published && state?.currentPhase === "syncing_bots",
    );
    const error = legacyPublishedAssets
      ? null
      : durableRun?.lastError ?? state?.lastError ?? null;
    const durablePaused = durableRun?.status === "paused";
    const checkpointRecoverable =
      hasCheckpoint &&
      durableRun?.status !== "failed" &&
      state?.currentPhase !== "failed";
    const phase: MarketSyncPhase =
      durablePaused || interruptedDurableRun || publicationFinalizationPending
      ? "paused"
      : durableRun?.status === "failed"
        ? "failed"
        : error
          ? "failed"
          : hasCheckpoint || publicationPending
        ? "paused"
        : published
          ? "completed"
          : "idle";
    const completionReason = (
      hasCheckpoint
        ? state?.completionReason
        : file.completionReason ?? state?.completionReason
    ) as MarketSyncCompletionReason | null | undefined;

    const targetAssets = hasCheckpoint
      ? checkpoint.targetAssets
      : state?.targetAssets || file.requestedLimit;
    const validAssets = hasCheckpoint
      ? checkpoint.validAssetCount
      : published
        ? state?.lastPublishedValidAssetCount ?? file.validAssetCount
        : state?.validAssetCount ?? file.validAssetCount;
    const rawAssets = hasCheckpoint
      ? checkpoint.rawAssetCount
      : published
        ? state?.lastPublishedRawAssetCount ?? file.rawAssetCount
        : state?.rawAssetCount ?? file.rawAssetCount;
    const skippedAssets = hasCheckpoint
      ? checkpoint.skippedAssetCount
      : published
        ? state?.lastPublishedSkippedAssetCount ?? file.skippedAssetCount
        : state?.skippedAssetCount ?? file.skippedAssetCount;
    const quotaUnitsUsed = rateLimit.quotaUnitsUsed;
    const candidatesVisited = hasCheckpoint
      ? checkpoint.candidatesVisited
      : state?.lastCandidatesVisited ?? 0;
    const totalCandidates = hasCheckpoint
      ? checkpoint.totalCandidates
      : state?.totalCandidates ?? 0;
    const runRecordForStatus =
      durableRun && interruptedDurableRun
        ? {
            ...durableRun,
            status: "paused" as const,
            currentPhase: "paused",
            latestAttemptFinishedAt:
              durableRun.latestAttemptFinishedAt ?? durableRun.lastHeartbeatAt,
          }
        : durableRun;
    const run = runRecordForStatus
      ? buildRunView(runRecordForStatus, validAssets, targetAssets)
      : null;
    return {
      ...runtime,
      run,
      running: false,
      resumable:
        durablePaused ||
        interruptedDurableRun ||
        publicationFinalizationPending ||
        checkpointRecoverable ||
        publicationPending,
      phase,
      targetAssets,
      requestedAssets: targetAssets,
      assetsPerItem: state?.assetsPerItem || 10,
      rawAssets,
      validAssets,
      skippedAssets,
      totalCandidates,
      maxPages: totalCandidates,
      candidatesVisited,
      currentPage: candidatesVisited,
      currentCandidate: state?.currentCandidate ?? null,
      quotaUnitsUsed,
      creditsUsed: hasCheckpoint
        ? checkpoint.creditsUsed
        : durableRun?.creditsUsed ?? runtime.creditsUsed,
      rowsUsed: quotaUnitsUsed,
      quotaLimit: rateLimit.effectiveCapacity,
      quotaResetsAt,
      rateLimitResetsAt: quotaResetsAt,
      listingsProcessed:
        state?.lastPublishedListingCount ?? state?.publishedListingCount ?? 0,
      totalListings:
        state?.lastPublishedListingCount ?? state?.publishedListingCount ?? 0,
      floatsIndexed:
        state?.lastPublishedFloatCount ?? state?.publishedFloatCount ?? 0,
      publishedListings:
        state?.lastPublishedListingCount ?? state?.publishedListingCount ?? 0,
      publishedFloats:
        state?.lastPublishedFloatCount ?? state?.publishedFloatCount ?? 0,
      lastPublished,
      snapshotHash:
        state?.lastPublishedSnapshotHash ?? file.version ?? state?.snapshotHash ?? null,
      snapshotFetchedAt: file.fetchedAt,
      completionReason: completionReason ?? null,
      itemsCatalog: null,
      lastStartedAt:
        durableRun?.latestAttemptStartedAt.toISOString() ??
        state?.lastStartedAt?.toISOString() ??
        null,
      lastFinishedAt:
        durableRun?.runFinishedAt?.toISOString() ??
        durableRun?.latestAttemptFinishedAt?.toISOString() ??
        state?.lastFinishedAt?.toISOString() ??
        null,
      lastSuccessfulAt:
        state?.lastSuccessfulAt?.toISOString() ??
        (legacyPublishedAssets
          ? state?.lastPublishedAt?.toISOString() ?? null
          : null),
      lastError: error,
      message: error
        ? durablePaused || interruptedDurableRun || publicationFinalizationPending
          ? `Sincronización pausada y recuperable: ${error}`
          : `La última sincronización falló: ${error}`
        : durablePaused ||
            interruptedDurableRun ||
            publicationFinalizationPending ||
            hasCheckpoint
          ? `Sincronización pausada con ${validAssets.toLocaleString("es-AR")}/${targetAssets.toLocaleString("es-AR")} assets válidos.`
          : published
            ? `Snapshot publicado: ${validAssets.toLocaleString("es-AR")} assets.`
            : runtime.message,
    };
  }
}
