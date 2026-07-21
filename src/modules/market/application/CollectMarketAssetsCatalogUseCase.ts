import type { IMarketSyncStateRepository } from "../domain/IMarketSyncStateRepository";
import type {
  IMarketAssetCandidateHistoryRepository,
  MarketAssetCandidateHistoryObservation,
  MarketAssetCandidateHistoryRecord,
} from "../domain/IMarketAssetCandidateHistoryRepository";
import type {
  IMarketSyncRunRepository,
  MarketSyncTelemetryDelta,
} from "../domain/MarketSyncRun";
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
  type MarketAssetsRequestOutcome,
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
  pageRequests: number;
  httpAttempts: number;
  httpSucceeded: number;
  httpFailed: number;
  retryCount: number;
  durationMs: number[];
  quotaUnitsUsed: number;
  creditsUsed: number;
  emptyResponses: number;
  notFound: boolean;
  quotaWaitCount: number;
  quotaWaitDurationMs: number;
}

const DEFAULT_OPTIONS: MarketAssetsCollectionOptions = {
  targetAssets: 10_000,
  assetsPerItem: 10,
  concurrency: 3,
  sort: "newest",
};

const ADAPTIVE_RETRY_BASE_DELAY_MS = 1_000;
const ADAPTIVE_RETRY_MAX_DELAY_MS = 30_000;
const MAX_EFFECTIVE_CONCURRENCY = 3;
const AIMD_SUCCESS_BATCHES_PER_INCREASE = 15;
const MAX_DEFERRED_RECOVERY_ATTEMPTS = 2;
const MAX_RATE_LIMIT_ATTEMPTS_PER_EXECUTION = 3;

export interface MarketAssetsCollectorClock {
  sleep(ms: number): Promise<void>;
}

export interface MarketAssetsCollectorRuntime extends MarketAssetsCollectorClock {
  random?(): number;
  historyRepository?: IMarketAssetCandidateHistoryRepository;
  runRepository?: Pick<
    IMarketSyncRunRepository,
    "getCurrentOrLast" | "recordTelemetry"
  >;
}

const systemRuntime: MarketAssetsCollectorRuntime = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
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
    options.concurrency > MAX_EFFECTIVE_CONCURRENCY
  ) {
    throw new Error("MARKET_ASSETS_CONCURRENCY debe estar entre 1 y 3.");
  }
  return options;
}

function emptyCandidateProgress(): MarketAssetsCandidateCheckpoint {
  return {
    initialLimit: 0,
    offset: 0,
    validAssetCount: 0,
    rawAssetCount: 0,
    skippedAssetCount: 0,
    quotaUnitsUsed: 0,
    creditsUsed: 0,
    providerTotal: 0,
    consecutiveFailures: 0,
    pageRequests: 0,
    httpAttempts: 0,
    deferredRecoveryAttempts: 0,
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
    runId: null,
    queueVersion: queue.version,
    targetAssets: options.targetAssets,
    assetsPerItem: options.assetsPerItem,
    sort: options.sort,
    concurrency: options.concurrency,
    effectiveConcurrency: Math.min(
      MAX_EFFECTIVE_CONCURRENCY,
      options.concurrency,
    ),
    successfulBatchesSinceReduction: 0,
    adaptiveFailureRounds: 0,
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
  checkpoint.effectiveConcurrency = Math.min(
    MAX_EFFECTIVE_CONCURRENCY,
    concurrency,
  );
  checkpoint.successfulBatchesSinceReduction = 0;
  checkpoint.adaptiveFailureRounds = 0;
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

function safeInitialLimitFromHistory(
  history: MarketAssetCandidateHistoryRecord | null | undefined,
  assetsPerItem: number,
): number {
  if (
    !history ||
    (history.outcome !== "available" &&
      history.outcome !== "empty" &&
      history.outcome !== "not_found")
  ) {
    return assetsPerItem;
  }
  if (history.outcome === "empty" || history.outcome === "not_found") {
    return 1;
  }
  const knownAvailable = Math.max(
    history.providerTotal,
    history.rawAssetCount,
    history.validAssetCount,
  );
  return Math.max(1, Math.min(assetsPerItem, knownAvailable || assetsPerItem));
}

function countDeferredCandidates(
  checkpoint: MarketAssetsCollectionCheckpoint,
): number {
  return Object.values(checkpoint.candidateProgress).filter(
    (progress) =>
      progress.completed &&
      Boolean(progress.lastError) &&
      progress.consecutiveFailures > 0,
  ).length;
}

function isCongestionError(error: MarketAssetsApiError | null): boolean {
  return Boolean(
    error &&
      error.kind === "retryable" &&
      error.status !== 429,
  );
}

function requestOutcomeForPage(page: {
  outcome?: MarketAssetsRequestOutcome;
  notFound?: boolean;
  assets: unknown[];
}): MarketAssetsRequestOutcome {
  return (
    page.outcome ??
    (page.notFound
      ? "not_found"
      : page.assets.length > 0
        ? "success"
        : "success_empty")
  );
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
    private readonly runtime: MarketAssetsCollectorRuntime = systemRuntime,
  ) {
    this.defaultOptions = validateOptions(optionsFromEnvironment(), options);
  }

  /**
   * Probe read-only usado antes de abrir/reutilizar una corrida durable. No
   * elimina checkpoints incompatibles: esa mutación queda en `execute`, una vez
   * que la corrida nueva ya fue creada. Los errores de readiness del catálogo
   * se propagan para no reemplazar una corrida recuperable a ciegas.
   */
  async hasCompatibleCheckpoint(
    overrides: Partial<MarketAssetsCollectionOptions> = {},
  ): Promise<boolean> {
    const checkpoint = await this.store.readCheckpoint();
    if (!checkpoint) return false;
    const options = validateOptions(this.defaultOptions, overrides);
    const queue = await this.priorityQueue.build();
    return canResumeCheckpoint(checkpoint, queue, options);
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
    let effectiveConcurrency = Math.max(
      1,
      Math.min(
        MAX_EFFECTIVE_CONCURRENCY,
        options.concurrency,
        checkpoint.effectiveConcurrency,
      ),
    );
    checkpoint.effectiveConcurrency = effectiveConcurrency;
    const historyHints = new Map<
      string,
      MarketAssetCandidateHistoryRecord | null
    >();
    let runId: string | null = checkpoint.runId;
    try {
      const syncState = await this.syncStateRepository.get(stateKey);
      runId =
        syncState?.activeRunId ??
        (await this.runtime.runRepository?.getCurrentOrLast(stateKey))?.id ??
        checkpoint.runId;
      if (checkpoint.runId !== runId) {
        checkpoint.runId = runId;
        await this.store.writeCheckpoint(checkpoint);
      }
    } catch (error) {
      console.error(
        "[Market Assets Sync] No se pudo resolver la corrida de telemetría:",
        error,
      );
    }
    try {
      await this.runtime.historyRepository?.prune();
    } catch (error) {
      // La retención de hints es mantenimiento best-effort y nunca debe
      // impedir una sincronización de mercado.
      console.error(
        "[Market Assets Sync] No se pudo depurar el historial de candidatos:",
        error,
      );
    }

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

    const failedAttemptsThisExecution = new Map<string, number>();
    const latencyByCandidate = new Map<string, number>();

    for (;;) {
      advanceCursor(checkpoint, queue);
      const prefixAssetCount = countAssetsInCompletedPrefix(
        checkpoint,
        rankByListing,
      );
      const reachedTerminalBoundary =
        prefixAssetCount >= options.targetAssets ||
        checkpoint.cursorIndex >= queue.candidates.length;

      if (reachedTerminalBoundary) {
        // Antes de publicar se recupera, en orden de prioridad, cualquier
        // timeout aislado que permitió avanzar un lote paralelo. La recuperación
        // siempre es serial y cada candidato dispone de dos rondas adicionales.
        const deferredIndex = queue.candidates.findIndex((candidate) => {
          const progress = checkpoint.candidateProgress[candidate.key];
          return Boolean(
            progress?.completed &&
              progress.lastError &&
              progress.consecutiveFailures > 0 &&
              (failedAttemptsThisExecution.get(candidate.key) ?? 0) < 3,
          );
        });
        if (deferredIndex >= 0) {
          const candidate = queue.candidates[deferredIndex]!;
          const progress = checkpoint.candidateProgress[candidate.key]!;
          progress.completed = false;
          progress.exhausted = false;
          progress.deferredRecoveryAttempts = Math.min(
            MAX_DEFERRED_RECOVERY_ATTEMPTS,
            progress.deferredRecoveryAttempts + 1,
          );
          checkpoint.cursorIndex = deferredIndex;
          const previousConcurrency = effectiveConcurrency;
          effectiveConcurrency = 1;
          checkpoint.effectiveConcurrency = 1;
          checkpoint.successfulBatchesSinceReduction = 0;
          if (previousConcurrency > 1) checkpoint.adaptiveFailureRounds++;
          recomputeCheckpointTotals(checkpoint);
          await this.store.writeCheckpoint(checkpoint);
          continue;
        }
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

      await this.loadHistoryHints(batch, historyHints);
      const attemptedConcurrency = batch.length;
      const globalIdsAtBatchStart = new Set(assetIds);
      const outcomes = await Promise.all(
        batch.map((candidate) =>
          this.collectCandidate(
            candidate,
            checkpoint,
            globalIdsAtBatchStart,
            options,
            stateKey,
            historyHints.get(candidate.key),
            (failedAttemptsThisExecution.get(candidate.key) ?? 0) > 0,
          ),
        ),
      );

      for (const outcome of outcomes) {
        latencyByCandidate.set(
          outcome.candidate.key,
          (latencyByCandidate.get(outcome.candidate.key) ?? 0) +
            outcome.durationMs.reduce((total, duration) => total + duration, 0),
        );
      }

      for (const outcome of outcomes) {
        if (!outcome.error) {
          failedAttemptsThisExecution.delete(outcome.candidate.key);
          continue;
        }
        const previous = outcome.httpSucceeded > 0
          ? 0
          : (failedAttemptsThisExecution.get(outcome.candidate.key) ?? 0);
        failedAttemptsThisExecution.set(outcome.candidate.key, previous + 1);
      }

      const fatalError = outcomes.find(
        (outcome) => outcome.error?.kind === "fatal",
      )?.error ?? null;
      const batchHasProviderProgress = outcomes.some(
        (outcome) => !outcome.error || outcome.httpSucceeded > 0,
      );
      const onlyCongestionFailures = outcomes.every(
        (outcome) =>
          outcome.assets.length === 0 && isCongestionError(outcome.error),
      );
      const hasCongestion = outcomes.some((outcome) =>
        isCongestionError(outcome.error),
      );
      const congestionFailureCount = outcomes.filter((outcome) =>
        isCongestionError(outcome.error),
      ).length;
      const shouldReduceConcurrency =
        onlyCongestionFailures ||
        congestionFailureCount / outcomes.length >= 0.5;

      let firstBlockingError: MarketAssetsApiError | null = fatalError;
      let retryRateLimitedBatch = false;
      let retryCongestedBatch = false;
      let retrySerialCandidate = false;
      let currentCandidate: string | null = null;

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
        // retoma desde el siguiente offset en vez de aceptar menos del máximo.
        if (
          progress.completed &&
          !progress.exhausted &&
          progress.validAssetCount < options.assetsPerItem &&
          !outcome.error
        ) {
          progress.completed = false;
        }

        const error = outcome.error;
        if (error && error.kind !== "candidate" && !fatalError) {
          const attempts =
            failedAttemptsThisExecution.get(outcome.candidate.key) ?? 1;
          if (error.status === 429) {
            if (attempts < MAX_RATE_LIMIT_ATTEMPTS_PER_EXECUTION) {
              retryRateLimitedBatch = true;
            } else if (!firstBlockingError) {
              firstBlockingError = error;
            }
          } else if (error.kind === "retryable") {
            if (batch.length > 1 && batchHasProviderProgress) {
              // Un fallo aislado se difiere, pero no se declara agotado. Se
              // recuperará serialmente antes de construir el snapshot.
              progress.completed = true;
              progress.exhausted = true;
            } else if (batch.length > 1 && onlyCongestionFailures) {
              if (attempts < 3) retryCongestedBatch = true;
              else if (!firstBlockingError) firstBlockingError = error;
            } else if (attempts < 3) {
              progress.deferredRecoveryAttempts = Math.min(
                MAX_DEFERRED_RECOVERY_ATTEMPTS,
                progress.deferredRecoveryAttempts + 1,
              );
              retrySerialCandidate = true;
            } else if (checkpoint.assets.length >= options.targetAssets) {
              // El objetivo global ya está fresco. Conservar la listing como
              // diferida/advertida permite publicar los 10k sin confundir este
              // timeout con `catalog_exhausted` ni perder toda la corrida.
              progress.completed = true;
              progress.exhausted = false;
            } else if (!firstBlockingError) {
              firstBlockingError = error;
            }
          }
        }
        checkpoint.candidateProgress[outcome.candidate.key] = progress;
      }

      const previousConcurrency = effectiveConcurrency;
      let concurrencyReductionCount = 0;
      let concurrencyIncreaseCount = 0;
      if (hasCongestion && !fatalError) {
        checkpoint.successfulBatchesSinceReduction = 0;
        checkpoint.adaptiveFailureRounds++;
        if (shouldReduceConcurrency && effectiveConcurrency > 1) {
          effectiveConcurrency = Math.max(
            1,
            Math.floor(effectiveConcurrency / 2),
          );
          concurrencyReductionCount = 1;
        }
      } else if (outcomes.every((outcome) => !outcome.error)) {
        checkpoint.adaptiveFailureRounds = 0;
        if (
          effectiveConcurrency <
          Math.min(MAX_EFFECTIVE_CONCURRENCY, options.concurrency)
        ) {
          checkpoint.successfulBatchesSinceReduction++;
          if (
            checkpoint.successfulBatchesSinceReduction >=
            AIMD_SUCCESS_BATCHES_PER_INCREASE
          ) {
            effectiveConcurrency++;
            concurrencyIncreaseCount = 1;
            checkpoint.successfulBatchesSinceReduction = 0;
          }
        } else {
          checkpoint.successfulBatchesSinceReduction = 0;
        }
      } else {
        checkpoint.successfulBatchesSinceReduction = 0;
      }

      if (retryCongestedBatch) {
        const earliest = outcomes.find((outcome) =>
          isCongestionError(outcome.error),
        );
        if (earliest) {
          earliest.progress.deferredRecoveryAttempts = Math.min(
            MAX_DEFERRED_RECOVERY_ATTEMPTS,
            earliest.progress.deferredRecoveryAttempts + 1,
          );
          checkpoint.candidateProgress[earliest.candidate.key] =
            earliest.progress;
        }
      }
      checkpoint.effectiveConcurrency = effectiveConcurrency;

      const shouldBackoff =
        hasCongestion &&
        !fatalError &&
        (retryCongestedBatch ||
          retrySerialCandidate ||
          (batch.length > 1 && batchHasProviderProgress));
      const backoffMs = shouldBackoff
        ? Math.min(
            ADAPTIVE_RETRY_MAX_DELAY_MS,
            Math.round(
              ADAPTIVE_RETRY_BASE_DELAY_MS *
                2 ** Math.max(0, checkpoint.adaptiveFailureRounds - 1) *
                (0.5 + (this.runtime.random?.() ?? 0.5)),
            ),
          )
        : 0;

      advanceCursor(checkpoint, queue);
      recomputeCheckpointTotals(checkpoint);
      await this.store.writeCheckpoint(checkpoint);
      await this.recordHistory(
        runId,
        queue.version,
        outcomes,
        attemptedConcurrency,
        latencyByCandidate,
      );

      const telemetry: MarketSyncTelemetryDelta = {
        pageRequests: outcomes.reduce(
          (total, outcome) => total + outcome.pageRequests,
          0,
        ),
        httpAttempts: outcomes.reduce(
          (total, outcome) => total + outcome.httpAttempts,
          0,
        ),
        httpSucceeded: outcomes.reduce(
          (total, outcome) => total + outcome.httpSucceeded,
          0,
        ),
        httpFailed: outcomes.reduce(
          (total, outcome) => total + outcome.httpFailed,
          0,
        ),
        retryCount: outcomes.reduce(
          (total, outcome) => total + outcome.retryCount,
          0,
        ),
        timeoutCount: outcomes.filter(
          (outcome) => outcome.error?.failureKind === "timeout",
        ).length,
        emptyResponseCount: outcomes.reduce(
          (total, outcome) => total + outcome.emptyResponses,
          0,
        ),
        notFoundCount: outcomes.filter((outcome) => outcome.notFound).length,
        rateLimitedCount: outcomes.filter(
          (outcome) => outcome.error?.failureKind === "rate_limited",
        ).length,
        quotaWaitCount: outcomes.reduce(
          (total, outcome) => total + outcome.quotaWaitCount,
          0,
        ),
        quotaWaitDurationMs: outcomes.reduce(
          (total, outcome) => total + outcome.quotaWaitDurationMs,
          0,
        ),
        retryBackoffDurationMs: backoffMs,
        requestLatenciesMs: outcomes.flatMap((outcome) => outcome.durationMs),
        runQuotaUnitsUsed: outcomes.reduce(
          (total, outcome) => total + outcome.quotaUnitsUsed,
          0,
        ),
        creditsUsed: outcomes.reduce(
          (total, outcome) => total + outcome.creditsUsed,
          0,
        ),
        currentConcurrency: effectiveConcurrency,
        minimumConcurrencyUsed: Math.min(
          attemptedConcurrency,
          effectiveConcurrency,
        ),
        peakInFlight: attemptedConcurrency,
        concurrencyReductionCount,
        concurrencyIncreaseCount,
        deferredCandidateCount: countDeferredCandidates(checkpoint),
      };

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
            firstBlockingError ||
            retryRateLimitedBatch ||
            retryCongestedBatch ||
            retrySerialCandidate ||
            previousConcurrency !== effectiveConcurrency
              ? "paused"
              : "collecting_assets",
          telemetry,
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

      if (firstBlockingError) throw firstBlockingError;
      if (backoffMs > 0) await this.runtime.sleep(backoffMs);
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

  private async loadHistoryHints(
    candidates: readonly MarketAssetsPriorityCandidate[],
    hints: Map<string, MarketAssetCandidateHistoryRecord | null>,
  ): Promise<void> {
    const repository = this.runtime.historyRepository;
    const missingKeys = candidates
      .map((candidate) => candidate.key)
      .filter((key) => !hints.has(key));
    if (!repository || missingKeys.length === 0) {
      for (const key of missingKeys) hints.set(key, null);
      return;
    }
    try {
      const records = await repository.getByCandidateKeys(missingKeys);
      const byKey = new Map(records.map((record) => [record.candidateKey, record]));
      for (const key of missingKeys) hints.set(key, byKey.get(key) ?? null);
    } catch (error) {
      // Los hints sólo ahorran cuota: nunca son requisito para recolectar.
      console.error(
        "[Market Assets Sync] No se pudo leer el historial de candidatos:",
        error,
      );
      for (const key of missingKeys) hints.set(key, null);
    }
  }

  private async recordHistory(
    runId: string | null,
    queueVersion: string,
    outcomes: readonly CandidateOutcome[],
    effectiveConcurrency: number,
    latencyByCandidate: ReadonlyMap<string, number>,
  ): Promise<void> {
    const repository = this.runtime.historyRepository;
    if (!repository) return;
    const observations: MarketAssetCandidateHistoryObservation[] = outcomes
      .filter((outcome) => !outcome.error && outcome.progress.completed)
      .map((outcome) => {
        const progress = outcome.progress;
        const historyOutcome =
          progress.providerTotal > 0 || progress.rawAssetCount > 0
            ? "available"
            : outcome.notFound
              ? "not_found"
              : "empty";
        return {
          candidateKey: outcome.candidate.key,
          queueVersion,
          marketHashName: outcome.candidate.marketHashName,
          outcome: historyOutcome,
          providerTotal: progress.providerTotal,
          rawAssetCount: progress.rawAssetCount,
          validAssetCount: progress.validAssetCount,
          skippedAssetCount: progress.skippedAssetCount,
          pageRequests: progress.pageRequests,
          httpAttempts: progress.httpAttempts,
          latencyMs: Math.max(
            0,
            Math.round(latencyByCandidate.get(outcome.candidate.key) ?? 0),
          ),
          lastOffset: progress.offset,
          effectiveConcurrency,
          errorStatus: null,
          errorMessage: null,
          observedAt: new Date(),
        } satisfies MarketAssetCandidateHistoryObservation;
      });
    if (observations.length === 0) return;
    try {
      await repository.recordObservations(runId, observations);
    } catch (error) {
      // Un fallo de telemetría no invalida assets ya obtenidos/checkpointados.
      console.error(
        "[Market Assets Sync] No se pudo guardar el historial de candidatos:",
        error,
      );
    }
  }

  private async collectCandidate(
    candidate: MarketAssetsPriorityCandidate,
    checkpoint: MarketAssetsCollectionCheckpoint,
    globalIdsAtBatchStart: Set<string>,
    options: MarketAssetsCollectionOptions,
    stateKey: string,
    history: MarketAssetCandidateHistoryRecord | null | undefined,
    retried: boolean,
  ): Promise<CandidateOutcome> {
    const progress: MarketAssetsCandidateCheckpoint = {
      ...(checkpoint.candidateProgress[candidate.key] ??
        emptyCandidateProgress()),
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
    let pageRequests = 0;
    let httpAttempts = 0;
    let httpSucceeded = 0;
    let httpFailed = 0;
    let retryCount = retried ? 1 : 0;
    const durationMs: number[] = [];
    let quotaUnitsUsed = 0;
    let creditsUsed = 0;
    let emptyResponses = 0;
    let notFound = false;
    let quotaWaitCount = 0;
    let quotaWaitDurationMs = 0;

    const result = (error: MarketAssetsApiError | null): CandidateOutcome => ({
      candidate,
      progress,
      assets: acceptedAssets,
      error,
      pageRequests,
      httpAttempts,
      httpSucceeded,
      httpFailed,
      retryCount,
      durationMs,
      quotaUnitsUsed,
      creditsUsed,
      emptyResponses,
      notFound,
      quotaWaitCount,
      quotaWaitDurationMs,
    });

    while (
      progress.validAssetCount < options.assetsPerItem &&
      !progress.exhausted
    ) {
      if (progress.offset === 0 && progress.initialLimit === 0) {
        progress.initialLimit = safeInitialLimitFromHistory(
          history,
          options.assetsPerItem,
        );
      }
      const remainingForListing =
        options.assetsPerItem - progress.validAssetCount;
      const remainingAtProvider =
        progress.providerTotal > 0
          ? Math.max(0, progress.providerTotal - progress.offset)
          : Number.POSITIVE_INFINITY;
      const pageLimit = Math.min(
        10,
        remainingForListing,
        remainingAtProvider,
        progress.offset === 0
          ? progress.initialLimit || options.assetsPerItem
          : 10,
      );
      if (pageLimit <= 0) {
        progress.exhausted = true;
        break;
      }

      pageRequests++;
      progress.pageRequests++;
      try {
        const page = await this.client.fetchCandidatePage(candidate, {
          limit: pageLimit,
          offset: progress.offset,
          sort: options.sort,
          onRateLimitWait: (waitMs) => {
            quotaWaitCount++;
            quotaWaitDurationMs += Math.max(0, Math.trunc(waitMs));
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
        const attempts = Math.max(1, page.httpAttempts ?? 1);
        const pageOutcome = requestOutcomeForPage(page);
        httpAttempts += attempts;
        progress.httpAttempts += attempts;
        if (pageOutcome === "not_found") {
          httpFailed += attempts;
          notFound = true;
        } else {
          httpSucceeded += attempts;
        }
        if (pageOutcome === "success_empty") emptyResponses++;
        if (Number.isFinite(page.durationMs) && Number(page.durationMs) >= 0) {
          durationMs.push(Number(page.durationMs));
        }
        quotaUnitsUsed += page.quotaUnitsUsed;
        creditsUsed += page.creditsUsed;
        progress.quotaUnitsUsed += page.quotaUnitsUsed;
        progress.creditsUsed += page.creditsUsed;
        progress.consecutiveFailures = 0;
        progress.deferredRecoveryAttempts = 0;
        progress.lastError = null;
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
          pageOutcome === "not_found" ||
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
        const attempts = Math.max(1, apiError.httpAttempts);
        httpAttempts += attempts;
        httpFailed += attempts;
        progress.httpAttempts += attempts;
        if (Number.isFinite(apiError.durationMs) && apiError.durationMs >= 0) {
          durationMs.push(apiError.durationMs);
        }
        quotaUnitsUsed += apiError.quotaUnitsUsed;
        creditsUsed += apiError.creditsUsed;
        progress.quotaUnitsUsed += apiError.quotaUnitsUsed;
        progress.creditsUsed += apiError.creditsUsed;
        progress.lastError = apiError.message;
        progress.consecutiveFailures++;

        if (apiError.kind === "candidate") {
          progress.completed = true;
          progress.exhausted = true;
          progress.consecutiveFailures = 0;
          return result(apiError);
        }
        return result(apiError);
      }
    }

    progress.completed =
      progress.exhausted || progress.validAssetCount >= options.assetsPerItem;
    return result(null);
  }
}
