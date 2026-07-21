import type { IMarketSyncStateRepository } from "../domain/IMarketSyncStateRepository";
import {
  MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION,
  type IMarketAssetsCatalogStore,
  type MarketAssetCatalogItem,
  type MarketAssetsCandidateCheckpoint,
  type MarketAssetsCatalogSnapshot,
  type MarketAssetsCatalogSort,
  type MarketAssetsCollectionCheckpoint,
  type MarketAssetsCompletionReason,
} from "../domain/MarketAssetsCatalog";
import {
  MarketAssetsApiError,
  type IMarketAssetsCatalogClient,
} from "./IMarketAssetsCatalogClient";
import {
  MarketAssetsCatalogSnapshotBuilder,
  type NormalizedMarketAssetsBatch,
} from "./MarketAssetsCatalogSnapshotBuilder";
import {
  MarketAssetsPriorityQueueBuilder,
  type MarketAssetsPriorityCandidate,
  type MarketAssetsPriorityQueue,
} from "./MarketAssetsPriorityQueue";
import { marketSyncProgressService } from "./MarketSyncProgressService";

export interface MarketAssetsCollectionOptions {
  targetAssets: number;
  assetsPerItem: number;
  concurrency: number;
  sort: MarketAssetsCatalogSort;
}

export interface MarketAssetsCollectionResult {
  snapshot: MarketAssetsCatalogSnapshot;
  resumedCheckpoint: boolean;
  completionReason: MarketAssetsCompletionReason;
}

interface CandidateOutcome {
  candidate: MarketAssetsPriorityCandidate;
  progress: MarketAssetsCandidateCheckpoint;
  assets: MarketAssetCatalogItem[];
  error: MarketAssetsApiError | null;
}

const DEFAULT_OPTIONS: MarketAssetsCollectionOptions = {
  targetAssets: 10_000,
  assetsPerItem: 10,
  concurrency: 3,
  sort: "newest",
};

const ADAPTIVE_RETRY_BASE_DELAY_MS = 1_000;
const ADAPTIVE_RETRY_MAX_DELAY_MS = 30_000;

export interface MarketAssetsCollectorClock {
  sleep(ms: number): Promise<void>;
}

const systemClock: MarketAssetsCollectorClock = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionsFromEnvironment(): MarketAssetsCollectionOptions {
  const rawSort = process.env.MARKET_ASSETS_SORT;
  const sort: MarketAssetsCatalogSort =
    rawSort === "oldest" ||
    rawSort === "lowest_float" ||
    rawSort === "highest_float"
      ? rawSort
      : "newest";
  return {
    targetAssets: positiveInteger(
      process.env.MARKET_ASSETS_TARGET,
      DEFAULT_OPTIONS.targetAssets,
    ),
    assetsPerItem: positiveInteger(
      process.env.MARKET_ASSETS_PER_ITEM,
      DEFAULT_OPTIONS.assetsPerItem,
    ),
    concurrency: positiveInteger(
      process.env.MARKET_ASSETS_CONCURRENCY,
      DEFAULT_OPTIONS.concurrency,
    ),
    sort,
  };
}

function validateOptions(
  base: MarketAssetsCollectionOptions,
  overrides: Partial<MarketAssetsCollectionOptions>,
): MarketAssetsCollectionOptions {
  const options = { ...base, ...overrides };
  if (!Number.isInteger(options.targetAssets) || options.targetAssets <= 0) {
    throw new Error("MARKET_ASSETS_TARGET debe ser un entero positivo.");
  }
  if (
    !Number.isInteger(options.assetsPerItem) ||
    options.assetsPerItem <= 0 ||
    options.assetsPerItem > 10
  ) {
    throw new Error("MARKET_ASSETS_PER_ITEM debe estar entre 1 y 10.");
  }
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency <= 0 ||
    options.concurrency > 50
  ) {
    throw new Error("MARKET_ASSETS_CONCURRENCY debe estar entre 1 y 50.");
  }
  return options;
}

function emptyCandidateProgress(): MarketAssetsCandidateCheckpoint {
  return {
    offset: 0,
    validAssetCount: 0,
    rawAssetCount: 0,
    skippedAssetCount: 0,
    quotaUnitsUsed: 0,
    creditsUsed: 0,
    providerTotal: 0,
    consecutiveFailures: 0,
    completed: false,
    exhausted: false,
    lastError: null,
  };
}

function createCheckpoint(
  queue: MarketAssetsPriorityQueue,
  options: MarketAssetsCollectionOptions,
): MarketAssetsCollectionCheckpoint {
  const now = new Date().toISOString();
  return {
    schemaVersion: MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION,
    queueVersion: queue.version,
    targetAssets: options.targetAssets,
    assetsPerItem: options.assetsPerItem,
    sort: options.sort,
    concurrency: options.concurrency,
    cursorIndex: 0,
    candidatesVisited: 0,
    totalCandidates: queue.candidates.length,
    rowsUsed: 0,
    quotaUnitsUsed: 0,
    creditsUsed: 0,
    rawAssetCount: 0,
    skippedAssetCount: 0,
    providerTotal: 0,
    startedAt: now,
    updatedAt: now,
    candidateProgress: {},
    assets: [],
  };
}

function canResumeCheckpoint(
  checkpoint: MarketAssetsCollectionCheckpoint | null,
  queue: MarketAssetsPriorityQueue,
  options: MarketAssetsCollectionOptions,
): checkpoint is MarketAssetsCollectionCheckpoint {
  return Boolean(
    checkpoint &&
      checkpoint.queueVersion === queue.version &&
      checkpoint.targetAssets === options.targetAssets &&
      checkpoint.assetsPerItem === options.assetsPerItem &&
      checkpoint.sort === options.sort &&
      checkpoint.totalCandidates === queue.candidates.length &&
      checkpoint.cursorIndex <= queue.candidates.length,
  );
}

/**
 * La concurrencia sólo controla cómo se recuperan las páginas; no cambia el
 * significado de los assets ya validados. Por eso un cambio de configuración
 * migra el checkpoint en lugar de descartarlo. Al reducirla también se reabren
 * listings que una corrida más agresiva había diferido por errores transitorios.
 */
function migrateCheckpointConcurrency(
  checkpoint: MarketAssetsCollectionCheckpoint,
  queue: MarketAssetsPriorityQueue,
  concurrency: number,
): boolean {
  if (checkpoint.concurrency === concurrency) return false;

  checkpoint.concurrency = concurrency;
  let firstReopenedIndex = checkpoint.cursorIndex;
  queue.candidates.forEach((candidate, index) => {
    const progress = checkpoint.candidateProgress[candidate.key];
    if (
      progress?.completed &&
      progress.lastError &&
      progress.consecutiveFailures > 0
    ) {
      progress.completed = false;
      progress.exhausted = false;
      firstReopenedIndex = Math.min(firstReopenedIndex, index);
    }
  });
  checkpoint.cursorIndex = firstReopenedIndex;
  recomputeCheckpointTotals(checkpoint);
  return true;
}

function recomputeCheckpointTotals(
  checkpoint: MarketAssetsCollectionCheckpoint,
): void {
  const progress = Object.values(checkpoint.candidateProgress);
  checkpoint.candidatesVisited = progress.filter((item) => item.completed).length;
  checkpoint.quotaUnitsUsed = progress.reduce(
    (total, item) => total + item.quotaUnitsUsed,
    0,
  );
  checkpoint.rowsUsed = checkpoint.quotaUnitsUsed;
  checkpoint.creditsUsed = progress.reduce(
    (total, item) => total + item.creditsUsed,
    0,
  );
  checkpoint.rawAssetCount = progress.reduce(
    (total, item) => total + item.rawAssetCount,
    0,
  );
  checkpoint.skippedAssetCount = progress.reduce(
    (total, item) => total + item.skippedAssetCount,
    0,
  );
  checkpoint.providerTotal = progress.reduce(
    (total, item) => total + item.providerTotal,
    0,
  );
  checkpoint.updatedAt = new Date().toISOString();
}

function advanceCursor(
  checkpoint: MarketAssetsCollectionCheckpoint,
  queue: MarketAssetsPriorityQueue,
): void {
  let cursor = checkpoint.cursorIndex;
  while (cursor < queue.candidates.length) {
    const candidate = queue.candidates[cursor]!;
    if (!checkpoint.candidateProgress[candidate.key]?.completed) break;
    cursor++;
  }
  checkpoint.cursorIndex = cursor;
}

function countAssetsInCompletedPrefix(
  checkpoint: MarketAssetsCollectionCheckpoint,
  rankByListing: Map<string, number>,
): number {
  return checkpoint.assets.reduce((count, asset) => {
    const rank = rankByListing.get(asset.listingName);
    return count + (rank != null && rank < checkpoint.cursorIndex ? 1 : 0);
  }, 0);
}

export class CollectMarketAssetsCatalogUseCase {
  private readonly defaultOptions: MarketAssetsCollectionOptions;

  constructor(
    private readonly client: IMarketAssetsCatalogClient,
    private readonly priorityQueue: MarketAssetsPriorityQueueBuilder,
    private readonly store: IMarketAssetsCatalogStore,
    private readonly syncStateRepository: IMarketSyncStateRepository,
    private readonly snapshotBuilder = new MarketAssetsCatalogSnapshotBuilder(),
    options: Partial<MarketAssetsCollectionOptions> = {},
    private readonly clock: MarketAssetsCollectorClock = systemClock,
  ) {
    this.defaultOptions = validateOptions(optionsFromEnvironment(), options);
  }

  async execute(
    stateKey: string,
    overrides: Partial<MarketAssetsCollectionOptions> = {},
  ): Promise<MarketAssetsCollectionResult> {
    const options = validateOptions(this.defaultOptions, overrides);
    const queue = await this.priorityQueue.build();
    const rankByListing = new Map(
      queue.candidates.map((candidate, index) => [
        candidate.marketHashName,
        index,
      ]),
    );

    const storedCheckpoint = await this.store.readCheckpoint();
    const resumable = canResumeCheckpoint(storedCheckpoint, queue, options);
    let checkpoint: MarketAssetsCollectionCheckpoint;
    if (resumable) {
      checkpoint = storedCheckpoint;
      if (
        migrateCheckpointConcurrency(
          checkpoint,
          queue,
          options.concurrency,
        )
      ) {
        await this.store.writeCheckpoint(checkpoint);
      }
    } else {
      if (storedCheckpoint) await this.store.deleteCheckpoint();
      checkpoint = createCheckpoint(queue, options);
      await this.store.writeCheckpoint(checkpoint);
    }

    const resumedCheckpoint = Boolean(
      resumable &&
        (checkpoint.assets.length > 0 || checkpoint.quotaUnitsUsed > 0),
    );
    const assetIds = new Set(checkpoint.assets.map((asset) => asset.assetId));
    let effectiveConcurrency = options.concurrency;
    let adaptiveFailureRounds = 0;

    marketSyncProgressService.startCollection({
      targetAssets: options.targetAssets,
      assetsPerItem: options.assetsPerItem,
      totalCandidates: queue.candidates.length,
      candidatesVisited: checkpoint.candidatesVisited,
      rawAssets: checkpoint.rawAssetCount,
      validAssets: checkpoint.assets.length,
      skippedAssets: checkpoint.skippedAssetCount,
      rowsUsed: checkpoint.quotaUnitsUsed,
      quotaUnitsUsed: checkpoint.quotaUnitsUsed,
      creditsUsed: checkpoint.creditsUsed,
    });

    for (;;) {
      advanceCursor(checkpoint, queue);
      const prefixAssetCount = countAssetsInCompletedPrefix(
        checkpoint,
        rankByListing,
      );
      if (
        prefixAssetCount >= options.targetAssets ||
        checkpoint.cursorIndex >= queue.candidates.length
      ) {
        break;
      }

      const remaining = options.targetAssets - prefixAssetCount;
      const candidatesNeeded = Math.max(
        1,
        Math.ceil(remaining / options.assetsPerItem),
      );
      const batch: MarketAssetsPriorityCandidate[] = [];
      for (
        let index = checkpoint.cursorIndex;
        index < queue.candidates.length &&
        batch.length < Math.min(effectiveConcurrency, candidatesNeeded);
        index++
      ) {
        const candidate = queue.candidates[index]!;
        if (!checkpoint.candidateProgress[candidate.key]?.completed) {
          batch.push(candidate);
        }
      }
      if (batch.length === 0) {
        throw new Error(
          "El checkpoint no puede avanzar aunque quedan candidatos incompletos.",
        );
      }

      const globalIdsAtBatchStart = new Set(assetIds);
      const outcomes = await Promise.all(
        batch.map((candidate) =>
          this.collectCandidate(
            candidate,
            checkpoint,
            globalIdsAtBatchStart,
            options,
            stateKey,
          ),
        ),
      );

      let firstBlockingError: MarketAssetsApiError | null = null;
      let retryRateLimitedBatch = false;
      let currentCandidate: string | null = null;
      // Si al menos una consulta del lote respondió, un timeout aislado es un
      // problema del candidato y no una caída global del proveedor. Se difiere
      // esa listing para poder continuar con las siguientes prioridades.
      const batchHasProviderProgress = outcomes.some(
        (outcome) => !outcome.error || outcome.assets.length > 0,
      );
      const batchHasOnlyRetryableFailures = outcomes.every(
        (outcome) =>
          outcome.assets.length === 0 &&
          outcome.error?.kind === "retryable" &&
          outcome.error.status !== 429,
      );
      const reduceConcurrency =
        !batchHasProviderProgress &&
        batchHasOnlyRetryableFailures &&
        batch.length > 1;
      for (const outcome of outcomes) {
        currentCandidate = outcome.candidate.marketHashName;
        const progress = outcome.progress;

        for (const item of outcome.assets) {
          if (assetIds.has(item.assetId)) {
            progress.validAssetCount--;
            progress.skippedAssetCount++;
            continue;
          }
          assetIds.add(item.assetId);
          checkpoint.assets.push(item);
        }

        // Una colisión entre tareas paralelas deja el candidato incompleto; se
        // retoma desde el siguiente offset en vez de aceptar menos de diez.
        if (
          progress.completed &&
          !progress.exhausted &&
          progress.validAssetCount < options.assetsPerItem &&
          !outcome.error
        ) {
          progress.completed = false;
        }

        if (outcome.error && outcome.error.kind !== "candidate") {
          if (
            outcome.error.status === 429 &&
            progress.consecutiveFailures < 3
          ) {
            retryRateLimitedBatch = true;
          } else if (
            outcome.error.kind === "retryable" &&
            outcome.error.status !== 429 &&
            batchHasProviderProgress
          ) {
            // El cliente ya agotó sus reintentos HTTP. Marcar esta listing como
            // diferida permite avanzar el cursor sin confundirla con agotada:
            // lastError/consecutiveFailures quedan en el checkpoint.
            progress.completed = true;
            progress.exhausted = true;
          } else if (!reduceConcurrency && !firstBlockingError) {
            firstBlockingError = outcome.error;
          }
        }
        checkpoint.candidateProgress[outcome.candidate.key] = progress;
      }

      advanceCursor(checkpoint, queue);
      recomputeCheckpointTotals(checkpoint);
      await this.store.writeCheckpoint(checkpoint);
      await this.syncStateRepository.markCollectionProgress(
        stateKey,
        queue.version,
        {
          cursorIndex: checkpoint.cursorIndex,
          rowsUsed: checkpoint.quotaUnitsUsed,
          quotaUnitsUsed: checkpoint.quotaUnitsUsed,
          candidatesVisited: checkpoint.candidatesVisited,
          totalCandidates: checkpoint.totalCandidates,
          currentCandidate,
          targetAssets: options.targetAssets,
          assetsPerItem: options.assetsPerItem,
          rawAssetCount: checkpoint.rawAssetCount,
          validAssetCount: checkpoint.assets.length,
          skippedAssetCount: checkpoint.skippedAssetCount,
          phase:
            firstBlockingError || retryRateLimitedBatch || reduceConcurrency
              ? "paused"
              : "collecting_assets",
        },
      );
      marketSyncProgressService.updateCollection({
        currentCandidate,
        candidatesVisited: checkpoint.candidatesVisited,
        rawAssets: checkpoint.rawAssetCount,
        validAssets: checkpoint.assets.length,
        skippedAssets: checkpoint.skippedAssetCount,
        rowsUsed: checkpoint.quotaUnitsUsed,
        quotaUnitsUsed: checkpoint.quotaUnitsUsed,
        creditsUsed: checkpoint.creditsUsed,
      });

      if (reduceConcurrency) {
        const attemptedConcurrency = Math.min(
          effectiveConcurrency,
          batch.length,
        );
        effectiveConcurrency = Math.max(
          1,
          Math.floor(attemptedConcurrency / 2),
        );
        adaptiveFailureRounds++;
        const backoffMs = Math.min(
          ADAPTIVE_RETRY_MAX_DELAY_MS,
          ADAPTIVE_RETRY_BASE_DELAY_MS * 2 ** (adaptiveFailureRounds - 1),
        );
        await this.clock.sleep(backoffMs);
        continue;
      }
      if (firstBlockingError) throw firstBlockingError;
      if (retryRateLimitedBatch) continue;
    }

    const deferredCandidates = queue.candidates.filter((candidate) => {
      const progress = checkpoint.candidateProgress[candidate.key];
      return Boolean(
        progress?.completed &&
          progress.lastError &&
          progress.consecutiveFailures > 0,
      );
    });

    // No publicar `catalog_exhausted` si en realidad quedaron consultas
    // transitorias sin resolver. Se reabren en el checkpoint para que una
    // ejecución manual o el próximo ciclo las vuelva a intentar.
    if (
      checkpoint.assets.length < options.targetAssets &&
      deferredCandidates.length > 0
    ) {
      let firstDeferredIndex = queue.candidates.length;
      for (const candidate of deferredCandidates) {
        const progress = checkpoint.candidateProgress[candidate.key]!;
        progress.completed = false;
        progress.exhausted = false;
        const candidateIndex = rankByListing.get(candidate.marketHashName);
        if (candidateIndex != null) {
          firstDeferredIndex = Math.min(firstDeferredIndex, candidateIndex);
        }
      }
      checkpoint.cursorIndex = firstDeferredIndex;
      recomputeCheckpointTotals(checkpoint);
      await this.store.writeCheckpoint(checkpoint);
      await this.syncStateRepository.markCollectionProgress(
        stateKey,
        queue.version,
        {
          cursorIndex: checkpoint.cursorIndex,
          rowsUsed: checkpoint.quotaUnitsUsed,
          quotaUnitsUsed: checkpoint.quotaUnitsUsed,
          candidatesVisited: checkpoint.candidatesVisited,
          totalCandidates: checkpoint.totalCandidates,
          currentCandidate: deferredCandidates[0]!.marketHashName,
          targetAssets: options.targetAssets,
          assetsPerItem: options.assetsPerItem,
          rawAssetCount: checkpoint.rawAssetCount,
          validAssetCount: checkpoint.assets.length,
          skippedAssetCount: checkpoint.skippedAssetCount,
          phase: "paused",
        },
      );
      throw new MarketAssetsApiError(
        `Quedaron ${deferredCandidates.length} listings con errores transitorios; el checkpoint se conservó para reintentarlas.`,
        "retryable",
        0,
        0,
      );
    }

    const orderedAssets = [...checkpoint.assets].sort((left, right) => {
      const leftRank = rankByListing.get(left.listingName) ?? Number.MAX_SAFE_INTEGER;
      const rightRank =
        rankByListing.get(right.listingName) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });
    const assets = orderedAssets.slice(0, options.targetAssets);
    const trimmedAssets = orderedAssets.length - assets.length;
    const completionReason: MarketAssetsCompletionReason =
      assets.length >= options.targetAssets
        ? "target_reached"
        : "catalog_exhausted";

    marketSyncProgressService.startSnapshotValidation(
      checkpoint.rawAssetCount,
    );
    const snapshot = this.snapshotBuilder.buildNormalized({
      assets,
      providerTotal: checkpoint.providerTotal,
      requestedLimit: options.targetAssets,
      rawAssetCount: checkpoint.rawAssetCount,
      skippedAssetCount: checkpoint.skippedAssetCount + trimmedAssets,
      sort: options.sort,
      sourceUrl: this.client.getSafeSourceUrl({
        limit: options.assetsPerItem,
        sort: options.sort,
      }),
      completionReason,
    });

    return { snapshot, resumedCheckpoint, completionReason };
  }

  private async collectCandidate(
    candidate: MarketAssetsPriorityCandidate,
    checkpoint: MarketAssetsCollectionCheckpoint,
    globalIdsAtBatchStart: Set<string>,
    options: MarketAssetsCollectionOptions,
    stateKey: string,
  ): Promise<CandidateOutcome> {
    const progress: MarketAssetsCandidateCheckpoint = {
      ...(checkpoint.candidateProgress[candidate.key] ??
        emptyCandidateProgress()),
      lastError: null,
    };
    const ownExistingIds = new Set(
      checkpoint.assets
        .filter((asset) => asset.listingName === candidate.marketHashName)
        .map((asset) => asset.assetId),
    );
    const foreignGlobalIds = new Set(globalIdsAtBatchStart);
    for (const ownId of ownExistingIds) foreignGlobalIds.delete(ownId);
    const acceptedIds = new Set(ownExistingIds);
    const acceptedAssets: MarketAssetCatalogItem[] = [];

    while (
      progress.validAssetCount < options.assetsPerItem &&
      !progress.exhausted
    ) {
      const pageLimit = Math.min(
        10,
        options.assetsPerItem - progress.validAssetCount,
      );
      try {
        const page = await this.client.fetchCandidatePage(candidate, {
          limit: pageLimit,
          offset: progress.offset,
          sort: options.sort,
          onRateLimitWait: (waitMs) => {
            marketSyncProgressService.waitForRateLimit(waitMs);
            void this.syncStateRepository
              .updateCurrentStatus(stateKey, {
                phase: "waiting_rate_limit",
                quotaUnitsUsed: checkpoint.quotaUnitsUsed,
                quotaResetsAt: new Date(Date.now() + waitMs),
              })
              .catch((error) =>
                console.error(
                  "[Market Assets Sync] No se pudo persistir la espera de cuota:",
                  error,
                ),
              );
          },
        });
        progress.quotaUnitsUsed += page.quotaUnitsUsed;
        progress.creditsUsed += page.creditsUsed;
        progress.consecutiveFailures = 0;
        progress.providerTotal = Math.max(
          progress.providerTotal,
          page.providerTotal,
        );
        progress.rawAssetCount += page.assets.length;

        const normalized: NormalizedMarketAssetsBatch =
          this.snapshotBuilder.normalizeMany(page.assets, candidate);
        progress.skippedAssetCount += normalized.skippedRows;
        for (const item of normalized.assets) {
          if (progress.validAssetCount >= options.assetsPerItem) {
            progress.skippedAssetCount++;
            continue;
          }
          if (acceptedIds.has(item.assetId) || foreignGlobalIds.has(item.assetId)) {
            progress.skippedAssetCount++;
            continue;
          }
          acceptedIds.add(item.assetId);
          acceptedAssets.push(item);
          progress.validAssetCount++;
        }

        progress.offset += pageLimit;
        const returnedAllAvailable =
          page.assets.length === 0 ||
          (page.providerTotal > 0
            ? progress.offset >= page.providerTotal
            : page.assets.length < pageLimit);
        if (returnedAllAvailable) progress.exhausted = true;
      } catch (error) {
        const apiError =
          error instanceof MarketAssetsApiError
            ? error
            : new MarketAssetsApiError(
                error instanceof Error ? error.message : String(error),
                "retryable",
                0,
                0,
              );
        progress.quotaUnitsUsed += apiError.quotaUnitsUsed;
        progress.creditsUsed += apiError.creditsUsed;
        progress.lastError = apiError.message;
        progress.consecutiveFailures++;

        if (apiError.kind === "candidate") {
          progress.completed = true;
          progress.exhausted = true;
          return {
            candidate,
            progress,
            assets: acceptedAssets,
            error: apiError,
          };
        }
        return {
          candidate,
          progress,
          assets: acceptedAssets,
          error: apiError,
        };
      }
    }

    progress.completed =
      progress.exhausted || progress.validAssetCount >= options.assetsPerItem;
    return { candidate, progress, assets: acceptedAssets, error: null };
  }
}
