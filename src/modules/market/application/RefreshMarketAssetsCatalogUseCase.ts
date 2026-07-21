import type {
  IMarketSyncStateRepository,
  MarketSnapshotCounts,
} from "../domain/IMarketSyncStateRepository";
import type { MarketSyncState } from "../domain/MarketSyncState";
import type {
  IMarketAssetsCatalogStore,
  MarketAssetsCatalogSnapshot,
  MarketAssetsCompletionReason,
} from "../domain/MarketAssetsCatalog";
import { CollectMarketAssetsCatalogUseCase } from "./CollectMarketAssetsCatalogUseCase";
import {
  MarketAssetsCatalogPublisher,
  type MarketCatalogPublicationResult,
} from "./MarketAssetsCatalogPublisher";
import {
  marketSyncProgressService,
  type MarketSyncCompletionReason,
} from "./MarketSyncProgressService";
import { MARKET_ASSETS_SYNC_STATE_KEY } from "./GetMarketSyncStatusUseCase";

export interface RefreshMarketAssetsResult {
  listings: number;
  floats: number;
  rawAssets: number;
  validAssets: number;
  skippedAssets: number;
  snapshotHash: string;
  fetchedAt: string;
  completionReason: MarketSyncCompletionReason;
  recoveredSnapshot: boolean;
}

function snapshotCounts(
  snapshot: MarketAssetsCatalogSnapshot,
): MarketSnapshotCounts {
  return {
    snapshotHash: snapshot.version,
    rawAssetCount: snapshot.rawAssetCount,
    validAssetCount: snapshot.validAssetCount,
    skippedAssetCount: snapshot.skippedAssetCount,
    completionReason: snapshot.completionReason,
  };
}

function publishedSnapshotNeedsFinalization(
  snapshotVersion: string,
  state: MarketSyncState | null,
): boolean {
  if (state?.lastPublishedSnapshotHash !== snapshotVersion) return false;
  if (
    state.currentPhase === "publishing_database" ||
    state.currentPhase === "syncing_bots"
  ) {
    return true;
  }
  if (
    state.currentPhase !== "failed" ||
    state.queueVersion !== snapshotVersion ||
    !state.lastPublishedAt ||
    !state.lastStartedAt
  ) {
    return false;
  }

  // Distingue un fallo posterior a markPublished de una corrida nueva que
  // falló antes de descargar otro snapshot y todavía conserva queueVersion.
  return state.lastPublishedAt.getTime() >= state.lastStartedAt.getTime();
}

export class RefreshMarketAssetsCatalogUseCase {
  private static activeExecution: Promise<RefreshMarketAssetsResult> | null = null;

  constructor(
    private collector: CollectMarketAssetsCatalogUseCase,
    private store: IMarketAssetsCatalogStore,
    private publisher: MarketAssetsCatalogPublisher,
    private syncStateRepository: IMarketSyncStateRepository,
  ) {}

  async hasPendingRecovery(): Promise<boolean> {
    const [checkpoint, snapshot, state] = await Promise.all([
      this.store.getCheckpointStatus(),
      this.store.getStatus(),
      this.syncStateRepository.get(MARKET_ASSETS_SYNC_STATE_KEY),
    ]);
    const unpublished = Boolean(
      snapshot.exists &&
        snapshot.version &&
        state?.lastPublishedSnapshotHash !== snapshot.version,
    );
    const publishedNeedsFinalization = Boolean(
      snapshot.exists &&
        snapshot.version &&
        publishedSnapshotNeedsFinalization(snapshot.version, state),
    );
    return checkpoint.exists || unpublished || publishedNeedsFinalization;
  }

  async recoverPending(): Promise<RefreshMarketAssetsResult | null> {
    const [checkpoint, snapshot, state] = await Promise.all([
      this.store.getCheckpointStatus(),
      this.store.readCatalog(),
      this.syncStateRepository.get(MARKET_ASSETS_SYNC_STATE_KEY),
    ]);

    if (
      snapshot &&
      state &&
      publishedSnapshotNeedsFinalization(snapshot.version, state)
    ) {
      // La DB ya quedó publicada. Un crash entre markPublished, el cleanup y
      // markFullSuccess no debe volver a consumir la API ni republicar la DB.
      // También normaliza estados syncing_bots producidos por la versión en la
      // que assets y bots formaban un único pipeline.
      if (checkpoint.exists) await this.store.deleteCheckpoint();
      return {
        listings: state.lastPublishedListingCount,
        floats: state.lastPublishedFloatCount,
        rawAssets: state.lastPublishedRawAssetCount,
        validAssets: state.lastPublishedValidAssetCount,
        skippedAssets: state.lastPublishedSkippedAssetCount,
        snapshotHash: snapshot.version,
        fetchedAt: snapshot.fetchedAt,
        completionReason:
          (snapshot.completionReason as MarketSyncCompletionReason | null) ??
          (state.completionReason as MarketSyncCompletionReason | null) ??
          "target_reached",
        recoveredSnapshot: true,
      };
    }

    const unpublished = Boolean(
      snapshot && state?.lastPublishedSnapshotHash !== snapshot.version,
    );
    if (snapshot && unpublished) {
      marketSyncProgressService.startSnapshotValidation(snapshot.rawAssetCount);
      marketSyncProgressService.snapshotValidated({
        validAssets: snapshot.validAssetCount,
        skippedAssets: snapshot.skippedAssetCount,
        snapshotHash: snapshot.version,
        fetchedAt: snapshot.fetchedAt,
        completionReason: snapshot.completionReason,
      });
      return this.publish(snapshot, true);
    }

    if (checkpoint.exists) return this.execute();
    return null;
  }

  async execute(): Promise<RefreshMarketAssetsResult> {
    if (RefreshMarketAssetsCatalogUseCase.activeExecution) {
      return RefreshMarketAssetsCatalogUseCase.activeExecution;
    }
    const execution = this.executeExclusive();
    RefreshMarketAssetsCatalogUseCase.activeExecution = execution;
    try {
      return await execution;
    } finally {
      if (RefreshMarketAssetsCatalogUseCase.activeExecution === execution) {
        RefreshMarketAssetsCatalogUseCase.activeExecution = null;
      }
    }
  }

  private async executeExclusive(): Promise<RefreshMarketAssetsResult> {
    try {
      const collected = await this.collector.execute(MARKET_ASSETS_SYNC_STATE_KEY);
      const snapshot = collected.snapshot;
      marketSyncProgressService.startSnapshotValidation(snapshot.rawAssetCount);
      marketSyncProgressService.snapshotValidated({
        validAssets: snapshot.validAssetCount,
        skippedAssets: snapshot.skippedAssetCount,
        snapshotHash: snapshot.version,
        fetchedAt: snapshot.fetchedAt,
        completionReason: collected.completionReason,
      });
      await this.store.writeCatalog(snapshot);
      await this.syncStateRepository.markSnapshotSaved(
        MARKET_ASSETS_SYNC_STATE_KEY,
        snapshotCounts(snapshot),
      );
      return await this.publish(snapshot, collected.resumedCheckpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.syncStateRepository
        .markFailed(MARKET_ASSETS_SYNC_STATE_KEY, message)
        .catch(() => undefined);
      throw error;
    }
  }

  private async publish(
    snapshot: MarketAssetsCatalogSnapshot,
    recoveredSnapshot: boolean,
  ): Promise<RefreshMarketAssetsResult> {
    marketSyncProgressService.startDatabaseSave(
      new Set(snapshot.assets.map((asset) => asset.listingName)).size,
    );
    const published: MarketCatalogPublicationResult =
      await this.publisher.publish(snapshot);
    await this.syncStateRepository.markPublished(
      MARKET_ASSETS_SYNC_STATE_KEY,
      snapshotCounts(snapshot),
      published,
    );
    await this.store.deleteCheckpoint();
    return {
      listings: published.listings,
      floats: published.floats,
      rawAssets: snapshot.rawAssetCount,
      validAssets: snapshot.validAssetCount,
      skippedAssets: snapshot.skippedAssetCount,
      snapshotHash: snapshot.version,
      fetchedAt: snapshot.fetchedAt,
      completionReason: snapshot.completionReason,
      recoveredSnapshot,
    };
  }
}
