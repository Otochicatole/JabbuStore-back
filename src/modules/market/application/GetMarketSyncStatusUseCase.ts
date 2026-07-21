import type { IMarketSyncStateRepository } from "../domain/IMarketSyncStateRepository";
import type { IMarketAssetsCatalogStore } from "../domain/MarketAssetsCatalog";
import {
  marketSyncProgressService,
  type MarketSyncCompletionReason,
  type MarketSyncPhase,
  type MarketSyncStatus,
} from "./MarketSyncProgressService";
import { floatRateLimiter } from "./FloatRateLimiter";

export const MARKET_ASSETS_SYNC_STATE_KEY = "youpin-assets-snapshot";

export class GetMarketSyncStatusUseCase {
  constructor(
    private store: IMarketAssetsCatalogStore,
    private syncStateRepository: IMarketSyncStateRepository,
  ) {}

  async execute(): Promise<MarketSyncStatus> {
    const runtime = marketSyncProgressService.getStatus();
    const [file, checkpoint, state, rateLimit] = await Promise.all([
      this.store.getStatus(),
      this.store.getCheckpointStatus(),
      this.syncStateRepository.get(MARKET_ASSETS_SYNC_STATE_KEY),
      floatRateLimiter
        .getDurableSnapshot()
        .catch(() => floatRateLimiter.getSnapshot()),
    ]);

    if (!file.exists && !checkpoint.exists && !state) {
      return {
        ...runtime,
        lastPublished: null,
        quotaUnitsUsed: rateLimit.quotaUnitsUsed,
        rowsUsed: rateLimit.quotaUnitsUsed,
        quotaLimit: rateLimit.effectiveCapacity,
        quotaResetsAt: new Date(rateLimit.windowResetsAt).toISOString(),
        rateLimitResetsAt: new Date(rateLimit.windowResetsAt).toISOString(),
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
      return {
        ...runtime,
        publishedListings: lastPublished?.publishedListings ?? 0,
        publishedFloats: lastPublished?.publishedFloats ?? 0,
        lastPublished,
        quotaUnitsUsed: rateLimit.quotaUnitsUsed,
        rowsUsed: rateLimit.quotaUnitsUsed,
        quotaLimit: rateLimit.effectiveCapacity,
        quotaResetsAt: new Date(rateLimit.windowResetsAt).toISOString(),
        rateLimitResetsAt: new Date(rateLimit.windowResetsAt).toISOString(),
        lastSuccessfulAt:
          state?.lastSuccessfulAt?.toISOString() ?? runtime.lastSuccessfulAt,
        itemsCatalog: null,
      };
    }

    const hasCheckpoint = checkpoint.exists;
    const published = Boolean(
      file.exists &&
        state?.lastPublishedSnapshotHash &&
        state.lastPublishedSnapshotHash === file.version,
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
    const error = legacyPublishedAssets ? null : state?.lastError ?? null;
    const phase: MarketSyncPhase = error
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
    return {
      ...runtime,
      running: false,
      resumable: hasCheckpoint || publicationPending,
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
      creditsUsed: hasCheckpoint ? checkpoint.creditsUsed : runtime.creditsUsed,
      rowsUsed: quotaUnitsUsed,
      quotaLimit: rateLimit.effectiveCapacity,
      quotaResetsAt: new Date(rateLimit.windowResetsAt).toISOString(),
      rateLimitResetsAt: new Date(rateLimit.windowResetsAt).toISOString(),
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
      lastStartedAt: state?.lastStartedAt?.toISOString() ?? null,
      lastFinishedAt: state?.lastFinishedAt?.toISOString() ?? null,
      lastSuccessfulAt:
        state?.lastSuccessfulAt?.toISOString() ??
        (legacyPublishedAssets
          ? state?.lastPublishedAt?.toISOString() ?? null
          : null),
      lastError: error,
      message: error
        ? `La última sincronización falló: ${error}`
        : hasCheckpoint
          ? `Sincronización pausada con ${validAssets.toLocaleString("es-AR")}/${targetAssets.toLocaleString("es-AR")} assets válidos.`
          : published
            ? `Snapshot publicado: ${validAssets.toLocaleString("es-AR")} assets.`
            : runtime.message,
    };
  }
}
