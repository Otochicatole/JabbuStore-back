import { prisma } from "../../../shared/infrastructure/PrismaClient";
import {
  IMarketSyncStateRepository,
  MarketCollectionProgress,
  MarketSnapshotCounts,
  MarketSyncCurrentStatusUpdate,
  MarketSyncStartOptions,
  MarketSyncStateProgress,
} from "../domain/IMarketSyncStateRepository";
import { MarketSyncState } from "../domain/MarketSyncState";
import type { IMarketSyncRunRepository } from "../domain/MarketSyncRun";

function stateCreateBase(key: string, queueVersion = "pending") {
  return { key, queueVersion };
}

export class PrismaMarketSyncStateRepository
  implements IMarketSyncStateRepository
{
  constructor(private readonly runRepository?: IMarketSyncRunRepository) {}

  async get(key: string): Promise<MarketSyncState | null> {
    const row = await prisma.marketSyncState.findUnique({ where: { key } });
    return row as MarketSyncState | null;
  }

  async markStarted(
    key: string,
    queueVersion?: string,
    cursorIndex = 0,
    options: MarketSyncStartOptions = {},
  ): Promise<void> {
    const now = new Date();
    const version = queueVersion ?? "pending";
    const currentPhase = options.phase ?? "building_priority_queue";
    const shared = {
      cursorIndex,
      lastRowsUsed: 0,
      lastCandidatesVisited: 0,
      lastError: null,
      lastStartedAt: now,
      lastFinishedAt: null,
      currentPhase,
      targetAssets: options.targetAssets ?? 0,
      assetsPerItem: options.assetsPerItem ?? 0,
      totalCandidates: 0,
      currentCandidate: null,
      quotaUnitsUsed: 0,
      quotaLimit: options.quotaLimit ?? 0,
      quotaResetsAt: null,
      completionReason: null,
      rawAssetCount: 0,
      validAssetCount: 0,
      skippedAssetCount: 0,
    };

    await prisma.marketSyncState.upsert({
      where: { key },
      create: { ...stateCreateBase(key, version), ...shared },
      update: {
        ...(queueVersion == null ? {} : { queueVersion }),
        ...shared,
      },
    });
    await this.runRepository?.recordProgress(key, {
      phase: currentPhase,
      targetAssets: options.targetAssets,
      assetsPerItem: options.assetsPerItem,
    });
  }

  async markCollectionProgress(
    key: string,
    queueVersion: string,
    progress: MarketCollectionProgress,
  ): Promise<void> {
    const data = {
      queueVersion,
      cursorIndex: progress.cursorIndex,
      lastRowsUsed: progress.rowsUsed,
      lastCandidatesVisited: progress.candidatesVisited,
      rawAssetCount: progress.rawAssetCount,
      validAssetCount: progress.validAssetCount,
      skippedAssetCount: progress.skippedAssetCount,
      currentPhase: progress.phase ?? "collecting_assets",
      ...(progress.totalCandidates == null
        ? {}
        : { totalCandidates: progress.totalCandidates }),
      ...(progress.currentCandidate === undefined
        ? {}
        : { currentCandidate: progress.currentCandidate }),
      ...(progress.targetAssets == null
        ? {}
        : { targetAssets: progress.targetAssets }),
      ...(progress.assetsPerItem == null
        ? {}
        : { assetsPerItem: progress.assetsPerItem }),
      ...(progress.quotaUnitsUsed == null
        ? {}
        : { quotaUnitsUsed: progress.quotaUnitsUsed }),
      ...(progress.quotaLimit == null
        ? {}
        : { quotaLimit: progress.quotaLimit }),
      ...(progress.quotaResetsAt === undefined
        ? {}
        : { quotaResetsAt: progress.quotaResetsAt }),
    };

    await prisma.marketSyncState.upsert({
      where: { key },
      create: { ...stateCreateBase(key, queueVersion), ...data },
      update: data,
    });
    await this.runRepository?.recordProgress(key, {
      phase: progress.phase ?? "collecting_assets",
      targetAssets: progress.targetAssets,
      assetsPerItem: progress.assetsPerItem,
      totalCandidates: progress.totalCandidates,
      candidatesVisited: progress.candidatesVisited,
      rawAssetCount: progress.rawAssetCount,
      validAssetCount: progress.validAssetCount,
      skippedAssetCount: progress.skippedAssetCount,
      telemetry: progress.telemetry,
    });
  }

  async updateCurrentStatus(
    key: string,
    update: MarketSyncCurrentStatusUpdate,
  ): Promise<void> {
    const data = {
      ...(update.phase === undefined ? {} : { currentPhase: update.phase }),
      ...(update.cursorIndex == null ? {} : { cursorIndex: update.cursorIndex }),
      ...(update.rowsUsed == null ? {} : { lastRowsUsed: update.rowsUsed }),
      ...(update.candidatesVisited == null
        ? {}
        : { lastCandidatesVisited: update.candidatesVisited }),
      ...(update.totalCandidates == null
        ? {}
        : { totalCandidates: update.totalCandidates }),
      ...(update.currentCandidate === undefined
        ? {}
        : { currentCandidate: update.currentCandidate }),
      ...(update.rawAssetCount == null
        ? {}
        : { rawAssetCount: update.rawAssetCount }),
      ...(update.validAssetCount == null
        ? {}
        : { validAssetCount: update.validAssetCount }),
      ...(update.skippedAssetCount == null
        ? {}
        : { skippedAssetCount: update.skippedAssetCount }),
      ...(update.quotaUnitsUsed == null
        ? {}
        : { quotaUnitsUsed: update.quotaUnitsUsed }),
      ...(update.quotaLimit == null
        ? {}
        : { quotaLimit: update.quotaLimit }),
      ...(update.quotaResetsAt === undefined
        ? {}
        : { quotaResetsAt: update.quotaResetsAt }),
      ...(update.completionReason === undefined
        ? {}
        : { completionReason: update.completionReason }),
      ...(update.error === undefined ? {} : { lastError: update.error }),
    };

    await prisma.marketSyncState.upsert({
      where: { key },
      create: { ...stateCreateBase(key), ...data },
      update: data,
    });
    await this.runRepository?.recordProgress(key, {
      phase: update.phase ?? undefined,
      totalCandidates: update.totalCandidates,
      candidatesVisited: update.candidatesVisited,
      rawAssetCount: update.rawAssetCount,
      validAssetCount: update.validAssetCount,
      skippedAssetCount: update.skippedAssetCount,
      completionReason: update.completionReason,
      telemetry: update.telemetry,
    });
  }

  async markSnapshotSaved(
    key: string,
    counts: MarketSnapshotCounts,
  ): Promise<void> {
    const now = new Date();
    const data = {
      snapshotHash: counts.snapshotHash,
      rawAssetCount: counts.rawAssetCount,
      validAssetCount: counts.validAssetCount,
      skippedAssetCount: counts.skippedAssetCount,
      completionReason: counts.completionReason ?? null,
      currentPhase: "publishing_database",
      lastDownloadedAt: now,
      lastError: null,
    };
    await prisma.marketSyncState.upsert({
      where: { key },
      create: { ...stateCreateBase(key, counts.snapshotHash), ...data },
      update: data,
    });
    await this.runRepository?.recordProgress(key, {
      phase: "publishing_database",
      rawAssetCount: counts.rawAssetCount,
      validAssetCount: counts.validAssetCount,
      skippedAssetCount: counts.skippedAssetCount,
      snapshotHash: counts.snapshotHash,
      completionReason: counts.completionReason,
    });
  }

  async markPublished(
    key: string,
    counts: MarketSnapshotCounts,
    published: { listings: number; floats: number },
  ): Promise<void> {
    const now = new Date();
    const data = {
      queueVersion: counts.snapshotHash,
      snapshotHash: counts.snapshotHash,
      rawAssetCount: counts.rawAssetCount,
      validAssetCount: counts.validAssetCount,
      skippedAssetCount: counts.skippedAssetCount,
      publishedListingCount: published.listings,
      publishedFloatCount: published.floats,
      lastPublishedSnapshotHash: counts.snapshotHash,
      lastPublishedRawAssetCount: counts.rawAssetCount,
      lastPublishedValidAssetCount: counts.validAssetCount,
      lastPublishedSkippedAssetCount: counts.skippedAssetCount,
      lastPublishedListingCount: published.listings,
      lastPublishedFloatCount: published.floats,
      completionReason: counts.completionReason ?? null,
      // Publicación terminada; RunFullCatalogSyncUseCase cierra la corrida con
      // markFullSuccess. Si el proceso cae entre ambos pasos, recoverPending
      // reconoce el hash ya publicado sin volver a consumir assets.
      currentPhase: "publishing_database",
      lastPublishedAt: now,
      lastError: null,
    };
    await prisma.marketSyncState.upsert({
      where: { key },
      create: { ...stateCreateBase(key, counts.snapshotHash), ...data },
      update: data,
    });
    await this.runRepository?.recordProgress(key, {
      phase: "publishing_database",
      rawAssetCount: counts.rawAssetCount,
      validAssetCount: counts.validAssetCount,
      skippedAssetCount: counts.skippedAssetCount,
      publishedListingCount: published.listings,
      publishedFloatCount: published.floats,
      snapshotHash: counts.snapshotHash,
      completionReason: counts.completionReason,
    });
  }

  async markFullSuccess(key: string): Promise<void> {
    const now = new Date();
    await prisma.marketSyncState.upsert({
      where: { key },
      create: {
        ...stateCreateBase(key, "completed"),
        currentPhase: "completed",
        lastFinishedAt: now,
        lastSuccessfulAt: now,
      },
      update: {
        currentPhase: "completed",
        currentCandidate: null,
        quotaResetsAt: null,
        lastError: null,
        lastFinishedAt: now,
        lastSuccessfulAt: now,
      },
    });
  }

  async markFailed(key: string, error: string, resumable = false): Promise<void> {
    await prisma.marketSyncState.upsert({
      where: { key },
      create: {
        ...stateCreateBase(key, "failed"),
        currentPhase: resumable ? "paused" : "failed",
        lastError: error,
        lastFinishedAt: new Date(),
      },
      update: {
        currentPhase: resumable ? "paused" : "failed",
        lastError: error,
        lastFinishedAt: new Date(),
      },
    });
  }

  async markCancelled(key: string, _message: string): Promise<void> {
    const finishedAt = new Date();
    await prisma.marketSyncState.upsert({
      where: { key },
      create: {
        ...stateCreateBase(key, "cancelled"),
        currentPhase: "cancelled",
        lastError: null,
        lastFinishedAt: finishedAt,
      },
      update: {
        currentPhase: "cancelled",
        currentCandidate: null,
        quotaResetsAt: null,
        lastError: null,
        lastFinishedAt: finishedAt,
      },
    });
  }

  async markFinished(
    key: string,
    queueVersion: string,
    progress: MarketSyncStateProgress,
  ): Promise<void> {
    const finishedAt = new Date();
    const data = {
      queueVersion,
      cursorIndex: progress.cursorIndex,
      lastRowsUsed: progress.lastRowsUsed,
      lastCandidatesVisited: progress.lastCandidatesVisited,
      lastError: progress.lastError ?? null,
      lastFinishedAt: finishedAt,
      currentPhase: progress.lastError ? "failed" : "completed",
    };
    await prisma.marketSyncState.upsert({
      where: { key },
      create: { ...stateCreateBase(key, queueVersion), ...data },
      update: data,
    });
  }
}
