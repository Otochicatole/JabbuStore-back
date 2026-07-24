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
  AdaptiveMarketAssetWorkerController,
  MARKET_ASSET_CONCURRENCY_STAGES,
  type MarketAssetRequestCompletion,
  type MarketAssetRequestOutcome,
} from "./AdaptiveMarketAssetWorkerController";
import { floatRateLimiter } from "./FloatRateLimiter";
import {
  MarketAssetsCatalogSnapshotBuilder,
  type NormalizedMarketAssetsBatch,
} from "./MarketAssetsCatalogSnapshotBuilder";
import {
  marketAssetsShutdownCoordinator,
  type MarketAssetsStopReason,
} from "./MarketAssetsShutdownCoordinator";
import {
  MarketAssetsPriorityQueueBuilder,
  type MarketAssetsPriorityCandidate,
  type MarketAssetsPriorityQueue,
} from "./MarketAssetsPriorityQueue";
import { marketSyncProgressService } from "./MarketSyncProgressService";

export interface MarketAssetsCollectionOptions {
  targetAssets: number;
  assetsPerItem: number;
  /** Workers con los que comienza una corrida nueva antes del slow-start. */
  initialConcurrency: number;
  /** Techo de workers HTTP en vuelo dentro del único proceso Node. */
  concurrency: number;
  /** Usa siempre el techo y deshabilita reducciones adaptativas por congestión. */
  forceMaxConcurrency: boolean;
  /** SLO de pared desde que comenzó la corrida hasta la publicación. */
  targetDurationSeconds: number;
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
  requestSamples: MarketAssetRequestCompletion[];
  dispatchedConcurrency: number;
}

interface InFlightCandidate {
  candidate: MarketAssetsPriorityCandidate;
  index: number;
  recovery: boolean;
  dispatchedConcurrency: number;
  abortController: AbortController;
  promise: Promise<CandidateOutcome>;
}

export class MarketAssetsCollectionInterruptedError extends Error {
  constructor() {
    super(
      "La recolección de assets fue pausada para apagar el proceso de forma segura.",
    );
    this.name = "MarketAssetsCollectionInterruptedError";
  }
}

export class MarketAssetsSyncCancelledError extends Error {
  constructor() {
    super(
      "Sincronización cancelada por un administrador. El progreso quedó guardado y no se publicó un snapshot parcial.",
    );
    this.name = "MarketAssetsSyncCancelledError";
  }
}

const DEFAULT_OPTIONS: MarketAssetsCollectionOptions = {
  targetAssets: 10_000,
  assetsPerItem: 10,
  initialConcurrency: 6,
  concurrency: 48,
  forceMaxConcurrency: false,
  targetDurationSeconds: 600,
  sort: "newest",
};

const MAX_EFFECTIVE_CONCURRENCY = 48;
const MAX_DEFERRED_RECOVERY_ATTEMPTS = 2;
const MAX_RATE_LIMIT_ATTEMPTS_PER_EXECUTION = 3;
const CHECKPOINT_FLUSH_INTERVAL_MS = 1_000;
const CHECKPOINT_FLUSH_OUTCOMES = 10;

export interface MarketAssetsCollectorClock {
  sleep(ms: number): Promise<void>;
}

export interface MarketAssetsCollectorRuntime extends MarketAssetsCollectorClock {
  now?(): number;
  random?(): number;
  historyRepository?: IMarketAssetCandidateHistoryRepository;
  runRepository?: Pick<
    IMarketSyncRunRepository,
    "getCurrentOrLast" | "recordTelemetry"
  >;
}

const systemRuntime: MarketAssetsCollectorRuntime = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).trim().toLowerCase() === "true";
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
    initialConcurrency: positiveInteger(
      process.env.MARKET_ASSETS_INITIAL_CONCURRENCY,
      DEFAULT_OPTIONS.initialConcurrency,
    ),
    concurrency: positiveInteger(
      process.env.MARKET_ASSETS_CONCURRENCY,
      DEFAULT_OPTIONS.concurrency,
    ),
    forceMaxConcurrency: booleanValue(
      process.env.MARKET_ASSETS_FORCE_MAX_CONCURRENCY,
      DEFAULT_OPTIONS.forceMaxConcurrency,
    ),
    targetDurationSeconds: positiveInteger(
      process.env.MARKET_ASSETS_TARGET_DURATION_SECONDS,
      DEFAULT_OPTIONS.targetDurationSeconds,
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
    throw new Error("MARKET_ASSETS_CONCURRENCY debe estar entre 1 y 48.");
  }
  if (typeof options.forceMaxConcurrency !== "boolean") {
    throw new Error(
      "MARKET_ASSETS_FORCE_MAX_CONCURRENCY debe ser booleano.",
    );
  }
  options.initialConcurrency = Math.min(
    options.concurrency,
    options.forceMaxConcurrency
      ? options.concurrency
      : options.initialConcurrency,
  );
  if (
    !Number.isInteger(options.initialConcurrency) ||
    options.initialConcurrency <= 0
  ) {
    throw new Error(
      "MARKET_ASSETS_INITIAL_CONCURRENCY debe ser un entero positivo.",
    );
  }
  if (
    !Number.isInteger(options.targetDurationSeconds) ||
    options.targetDurationSeconds <= 0
  ) {
    throw new Error(
      "MARKET_ASSETS_TARGET_DURATION_SECONDS debe ser un entero positivo.",
    );
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
  const initialConcurrency = Math.min(
    options.initialConcurrency,
    options.concurrency,
  );
  return {
    schemaVersion: MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION,
    runId: null,
    queueVersion: queue.version,
    targetAssets: options.targetAssets,
    assetsPerItem: options.assetsPerItem,
    sort: options.sort,
    concurrency: options.concurrency,
    initialConcurrency,
    effectiveConcurrency: initialConcurrency,
    rampStage: Math.max(
      0,
      MARKET_ASSET_CONCURRENCY_STAGES.findIndex(
        (value) => value >= initialConcurrency,
      ),
    ),
    latencyBaselineMs: null,
    recentHealthSamples: [],
    concurrencyCooldownUntil: null,
    consecutiveCongestionFailures: 0,
    circuitBreaker: {
      state: "closed",
      openCount: 0,
      resumeAt: null,
    },
    targetDurationSeconds: options.targetDurationSeconds,
    targetDeadlineAt: new Date(
      Date.parse(now) + options.targetDurationSeconds * 1_000,
    ).toISOString(),
    tenMinuteTargetUnreachable: false,
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
function migrateCheckpointWorkerConfiguration(
  checkpoint: MarketAssetsCollectionCheckpoint,
  queue: MarketAssetsPriorityQueue,
  options: MarketAssetsCollectionOptions,
): boolean {
  const configurationChanged =
    checkpoint.concurrency !== options.concurrency ||
    checkpoint.initialConcurrency !==
      Math.min(options.initialConcurrency, options.concurrency) ||
    checkpoint.targetDurationSeconds !== options.targetDurationSeconds;
  if (!configurationChanged) return false;

  checkpoint.concurrency = options.concurrency;
  checkpoint.initialConcurrency = Math.min(
    options.initialConcurrency,
    options.concurrency,
  );
  checkpoint.effectiveConcurrency = options.forceMaxConcurrency
    ? options.concurrency
    : Math.max(
        1,
        Math.min(checkpoint.effectiveConcurrency, options.concurrency),
      );
  if (options.forceMaxConcurrency) {
    checkpoint.rampStage = Math.max(
      0,
      MARKET_ASSET_CONCURRENCY_STAGES.findIndex(
        (value) => value >= options.concurrency,
      ),
    );
    checkpoint.concurrencyCooldownUntil = null;
    checkpoint.consecutiveCongestionFailures = 0;
  }
  checkpoint.targetDurationSeconds = options.targetDurationSeconds;
  checkpoint.targetDeadlineAt = new Date(
    Date.parse(checkpoint.startedAt) + options.targetDurationSeconds * 1_000,
  ).toISOString();
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

function rawAssetPageFingerprint(assets: readonly unknown[]): string {
  return assets
    .map((asset) => {
      if (asset && typeof asset === "object") {
        const record = asset as Record<string, unknown>;
        const id = record.assetid ?? record.asset_id ?? record.id;
        if (id != null) return String(id);
      }
      try {
        return JSON.stringify(asset) ?? String(asset);
      } catch {
        return String(asset);
      }
    })
    .join("\u001f");
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
    this.client.resetRequestPacing?.();
    const queue = await this.priorityQueue.build();
    const rankByListing = new Map(
      queue.candidates.map((candidate, index) => [
        candidate.marketHashName,
        index,
      ]),
    );

    // Fetch active YouPin listings in bulk to pre-filter candidate keys
    let activeListings: any[] = [];
    if (typeof this.client.fetchActiveYoupinPrices === "function") {
      try {
        console.log("[Market Assets Sync] Fetching active YouPin prices in bulk...");
        activeListings = await this.client.fetchActiveYoupinPrices();
      } catch (error) {
        console.error("[Market Assets Sync] Falló la precarga de precios YouPin:", error);
      }
    }
    const hasActiveListings = activeListings.length > 0;
    const activeSet = new Set<string>();
    if (hasActiveListings) {
      const activeMap = new Map<string, any>();
      for (const item of activeListings) {
        if (item.market_hash_name) {
          activeMap.set(item.market_hash_name.trim(), item);
        }
      }
      for (const candidate of queue.candidates) {
        if (candidate.phase) {
          const activeItem = activeMap.get(candidate.queryMarketHashName);
          if (activeItem && activeItem.variants && activeItem.variants[candidate.phase] !== undefined) {
            activeSet.add(candidate.key);
          }
        } else {
          const activeItem = activeMap.get(candidate.marketHashName);
          if (activeItem && activeItem.quantity > 0) {
            activeSet.add(candidate.key);
          }
        }
      }
      console.log(
        `[Market Assets Sync] Precargados ${activeListings.length} items activos. ${activeSet.size}/${queue.candidates.length} candidatos tienen stock en YouPin.`
      );
    }

    const storedCheckpoint = await this.store.readCheckpoint();
    const resumable = canResumeCheckpoint(storedCheckpoint, queue, options);
    let checkpoint: MarketAssetsCollectionCheckpoint;
    if (resumable) {
      checkpoint = storedCheckpoint;
      if (
        migrateCheckpointWorkerConfiguration(
          checkpoint,
          queue,
          options,
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
    const historyHints = new Map<
      string,
      MarketAssetCandidateHistoryRecord | null
    >();
    let runId: string | null = checkpoint.runId;
    try {
      const syncState = await this.syncStateRepository.get(stateKey);
      const durableRun =
        await this.runtime.runRepository?.getCurrentOrLast(stateKey);
      runId =
        syncState?.activeRunId ??
        durableRun?.id ??
        checkpoint.runId;
      if (durableRun?.runStartedAt) {
        checkpoint.targetDeadlineAt = new Date(
          durableRun.runStartedAt.getTime() +
            options.targetDurationSeconds * 1_000,
        ).toISOString();
      }
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

    let controller: AdaptiveMarketAssetWorkerController;
    try {
      controller =
        AdaptiveMarketAssetWorkerController.restoreFromCheckpoint(
          checkpoint,
          {
            maxConcurrency: options.concurrency,
            forceMaxConcurrency: options.forceMaxConcurrency,
          },
        );
    } catch (error) {
      console.error(
        "[Market Assets Sync] El estado adaptativo no era recuperable; se reinicia de forma conservadora:",
        error,
      );
      controller = new AdaptiveMarketAssetWorkerController({
        initialConcurrency: Math.min(
          options.initialConcurrency,
          options.concurrency,
        ),
        maxConcurrency: options.concurrency,
        forceMaxConcurrency: options.forceMaxConcurrency,
      });
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
    const lastRetryableErrors = new Map<string, MarketAssetsApiError>();
    const inFlight = new Map<string, InFlightCandidate>();
    const activeKeys = new Set<string>();
    const recoveryKeys = new Set(
      queue.candidates
        .filter((candidate) => {
          const progress = checkpoint.candidateProgress[candidate.key];
          return Boolean(
            progress &&
              !progress.completed &&
              progress.lastError &&
              progress.deferredRecoveryAttempts > 0,
          );
        })
        .map((candidate) => candidate.key),
    );
    const shutdownAbortController = new AbortController();
    let nextScanIndex = checkpoint.cursorIndex;
    let logicalNow = this.runtime.now?.() ?? Date.now();
    const now = () => {
      logicalNow = Math.max(
        logicalNow,
        this.runtime.now?.() ?? Date.now(),
      );
      return logicalNow;
    };
    const sleep = async (milliseconds: number) => {
      const delay = Math.max(0, Math.trunc(milliseconds));
      await this.runtime.sleep(delay);
      logicalNow = Math.max(
        logicalNow + delay,
        this.runtime.now?.() ?? Date.now(),
      );
    };
    const deadlineAt = () => {
      const parsed = Date.parse(checkpoint.targetDeadlineAt);
      return Number.isFinite(parsed)
        ? parsed
        : Date.parse(checkpoint.startedAt) +
            options.targetDurationSeconds * 1_000;
    };
    const publishableAssetCount = () =>
      countAssetsInCompletedPrefix(checkpoint, rankByListing);
    const demand = () => ({
      remainingAssets: Math.max(
        0,
        options.targetAssets - publishableAssetCount(),
      ),
      remainingMs: Math.max(0, deadlineAt() - now()),
    });
    let decision = controller.evaluate(demand(), now());
    let blockingError: MarketAssetsApiError | null = null;
    let currentCandidate: string | null = null;
    let pendingOutcomes: CandidateOutcome[] = [];
    let pendingBackoffMs = 0;
    let pendingConcurrencyReductions = 0;
    let pendingConcurrencyIncreases = 0;
    let peakInFlightSinceFlush = 0;
    let outcomesSinceFlush = 0;
    let lastFlushAt = now();
    let terminationRequested = false;
    const stopRequest: { reason: MarketAssetsStopReason } = {
      reason: "shutdown",
    };
    let notifyTerminationRequested!: () => void;
    const terminationRequestedPromise = new Promise<void>((resolve) => {
      notifyTerminationRequested = resolve;
    });
    let notifyShutdownCompleted!: () => void;
    const shutdownCompletedPromise = new Promise<void>((resolve) => {
      notifyShutdownCompleted = resolve;
    });

    const syncControllerCheckpoint = () => {
      Object.assign(checkpoint, controller.toCheckpointState());
      checkpoint.targetDurationSeconds = options.targetDurationSeconds;
      checkpoint.tenMinuteTargetUnreachable =
        checkpoint.tenMinuteTargetUnreachable ||
        (now() >= deadlineAt() &&
          publishableAssetCount() < options.targetAssets);
    };
    const phaseForDecision = (): "collecting_assets" | "waiting_rate_limit" | "paused" => {
      if (blockingError) return "paused";
      if (
        decision.state === "breaker_open" &&
        decision.circuitBreaker.reason === "rate_limited"
      ) {
        return "waiting_rate_limit";
      }
      return decision.state === "breaker_open" ? "paused" : "collecting_assets";
    };
    const queueDepth = () => {
      const completed = Object.values(checkpoint.candidateProgress).filter(
        (progress) => progress.completed,
      ).length;
      return Math.max(0, queue.candidates.length - completed - inFlight.size);
    };
    const publishWorkerRuntime = () => {
      const requestPacer = this.client.getRequestPacerSnapshot?.() ?? null;
      marketSyncProgressService.updateWorkerRuntime({
        initialConcurrency: checkpoint.initialConcurrency,
        maxConcurrency: options.concurrency,
        effectiveConcurrency: decision.effectiveConcurrency,
        requiredConcurrency: decision.requiredConcurrency,
        inFlight: inFlight.size,
        queueDepth: queueDepth(),
        circuitBreaker: {
          state: decision.circuitBreaker.state,
          openCount: decision.circuitBreaker.openedCount,
          resumeAt:
            decision.circuitBreaker.resumeAt == null
              ? null
              : new Date(decision.circuitBreaker.resumeAt).toISOString(),
        },
        requestPacer: requestPacer
          ? {
              initialStartsPerSecond:
                requestPacer.initialStartsPerSecond,
              maximumStartsPerSecond:
                requestPacer.maximumStartsPerSecond,
              currentStartsPerSecond:
                requestPacer.currentStartsPerSecond,
              queued: requestPacer.queued,
              gateState: requestPacer.gate.state,
              gateReason: requestPacer.gate.reason,
              gateResumeAt:
                requestPacer.gate.resumeAt == null
                  ? null
                  : new Date(requestPacer.gate.resumeAt).toISOString(),
            }
          : null,
        targetDurationSeconds: options.targetDurationSeconds,
        targetDeadlineAt: checkpoint.targetDeadlineAt,
        tenMinuteTargetUnreachable:
          checkpoint.tenMinuteTargetUnreachable,
      });
    };

    const flushProgress = async (
      force = false,
      phase = phaseForDecision(),
    ): Promise<void> => {
      if (
        !force &&
        outcomesSinceFlush < CHECKPOINT_FLUSH_OUTCOMES &&
        now() - lastFlushAt < CHECKPOINT_FLUSH_INTERVAL_MS
      ) {
        return;
      }

      advanceCursor(checkpoint, queue);
      recomputeCheckpointTotals(checkpoint);
      syncControllerCheckpoint();
      await this.store.writeCheckpoint(checkpoint);

      const outcomes = pendingOutcomes;
      if (outcomes.length > 0) {
        await this.recordHistory(
          runId,
          queue.version,
          outcomes,
          latencyByCandidate,
        );
      }
      const minimumConcurrencyUsed =
        outcomes.length > 0
          ? Math.min(
              ...outcomes.map((outcome) => outcome.dispatchedConcurrency),
            )
          : Math.max(1, decision.dispatchConcurrency);
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
        timeoutCount: outcomes.reduce(
          (total, outcome) =>
            total +
            outcome.requestSamples.filter(
              (sample) => sample.outcome === "timeout",
            ).length,
          0,
        ),
        emptyResponseCount: outcomes.reduce(
          (total, outcome) => total + outcome.emptyResponses,
          0,
        ),
        notFoundCount: outcomes.filter((outcome) => outcome.notFound).length,
        rateLimitedCount: outcomes.reduce(
          (total, outcome) =>
            total +
            outcome.requestSamples.filter(
              (sample) => sample.outcome === "rate_limited",
            ).length,
          0,
        ),
        quotaWaitCount: outcomes.reduce(
          (total, outcome) => total + outcome.quotaWaitCount,
          0,
        ),
        quotaWaitDurationMs: outcomes.reduce(
          (total, outcome) => total + outcome.quotaWaitDurationMs,
          0,
        ),
        retryBackoffDurationMs: pendingBackoffMs,
        requestLatenciesMs: outcomes.flatMap((outcome) => outcome.durationMs),
        runQuotaUnitsUsed: outcomes.reduce(
          (total, outcome) => total + outcome.quotaUnitsUsed,
          0,
        ),
        creditsUsed: outcomes.reduce(
          (total, outcome) => total + outcome.creditsUsed,
          0,
        ),
        currentConcurrency: decision.effectiveConcurrency,
        minimumConcurrencyUsed,
        peakInFlight: Math.max(
          peakInFlightSinceFlush,
          inFlight.size,
        ),
        concurrencyReductionCount: pendingConcurrencyReductions,
        concurrencyIncreaseCount: pendingConcurrencyIncreases,
        deferredCandidateCount: countDeferredCandidates(checkpoint),
      };

      try {
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
            phase,
            telemetry,
          },
        );
      } catch (error) {
        // El checkpoint de archivos ya quedó durable. Una caída temporal de
        // Prisma no debe abandonar requests activos ni perder sus assets; el
        // estado se reconciliará en el próximo flush o en la publicación.
        console.error(
          "[Market Assets Sync] No se pudo actualizar la telemetría durable:",
          error,
        );
      }
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
      publishWorkerRuntime();

      pendingOutcomes = [];
      pendingBackoffMs = 0;
      pendingConcurrencyReductions = 0;
      pendingConcurrencyIncreases = 0;
      peakInFlightSinceFlush = inFlight.size;
      outcomesSinceFlush = 0;
      lastFlushAt = now();
    };

    const integrateOutcome = async (
      outcome: CandidateOutcome,
      index: number,
      recovery: boolean,
      flushAfterIntegration = true,
    ): Promise<void> => {
      currentCandidate = outcome.candidate.marketHashName;
      latencyByCandidate.set(
        outcome.candidate.key,
        (latencyByCandidate.get(outcome.candidate.key) ?? 0) +
          outcome.durationMs.reduce(
            (total, duration) => total + duration,
            0,
          ),
      );

      if (
        !outcome.error ||
        outcome.error.failureKind === "cancelled"
      ) {
        failedAttemptsThisExecution.delete(outcome.candidate.key);
        lastRetryableErrors.delete(outcome.candidate.key);
      } else {
        const previous =
          outcome.httpSucceeded > 0
            ? 0
            : failedAttemptsThisExecution.get(outcome.candidate.key) ?? 0;
        failedAttemptsThisExecution.set(
          outcome.candidate.key,
          previous + 1,
        );
        if (outcome.error.kind === "retryable") {
          lastRetryableErrors.set(
            outcome.candidate.key,
            outcome.error,
          );
        }
      }

      const progress = outcome.progress;
      let duplicateAssets = 0;
      for (const item of outcome.assets) {
        if (assetIds.has(item.assetId)) {
          progress.validAssetCount--;
          progress.skippedAssetCount++;
          duplicateAssets++;
          continue;
        }
        assetIds.add(item.assetId);
        checkpoint.assets.push(item);
      }
      if (duplicateAssets > 0) {
        for (
          let sampleIndex = outcome.requestSamples.length - 1;
          sampleIndex >= 0 && duplicateAssets > 0;
          sampleIndex--
        ) {
          const sample = outcome.requestSamples[sampleIndex]!;
          const removable = Math.min(
            duplicateAssets,
            Math.trunc(sample.validAssets ?? 0),
          );
          sample.validAssets = Math.max(
            0,
            Math.trunc(sample.validAssets ?? 0) - removable,
          );
          duplicateAssets -= removable;
        }
      }

      if (
        progress.completed &&
        !progress.exhausted &&
        progress.validAssetCount < options.assetsPerItem &&
        !outcome.error
      ) {
        progress.completed = false;
        nextScanIndex = Math.min(nextScanIndex, index);
      }

      const error = outcome.error;
      if (error && error.kind !== "candidate") {
        const attempts =
          failedAttemptsThisExecution.get(outcome.candidate.key) ?? 1;
        if (error.failureKind === "cancelled") {
          progress.completed = false;
          progress.exhausted = false;
        } else if (error.kind === "fatal") {
          blockingError ??= error;
          progress.completed = false;
          progress.exhausted = false;
          nextScanIndex = Math.min(nextScanIndex, index);
        } else if (error.status === 429) {
          progress.completed = false;
          progress.exhausted = false;
          nextScanIndex = Math.min(nextScanIndex, index);
          if (attempts >= MAX_RATE_LIMIT_ATTEMPTS_PER_EXECUTION) {
            blockingError ??= error;
          }
        } else if (recovery) {
          // Se deja finalizar la ronda completa en paralelo. Si después de
          // las dos rondas todavía faltan assets, el chequeo de unresolved
          // pausa la corrida conservando el snapshot anterior.
          progress.completed = true;
          progress.exhausted = true;
        } else {
          // La primera falla se difiere para mantener los slots productivos.
          // Sólo se recupera al final si todavía faltan assets.
          progress.completed = true;
          progress.exhausted = true;
        }
      }
      checkpoint.candidateProgress[outcome.candidate.key] = progress;
      if (recovery && progress.completed) {
        recoveryKeys.delete(outcome.candidate.key);
      }

      const previousEffective = decision.effectiveConcurrency;
      for (const sample of outcome.requestSamples) {
        decision = controller.observe(sample, demand());
      }
      if (decision.effectiveConcurrency < previousEffective) {
        pendingConcurrencyReductions++;
      } else if (decision.effectiveConcurrency > previousEffective) {
        pendingConcurrencyIncreases++;
      }
      syncControllerCheckpoint();
      advanceCursor(checkpoint, queue);
      pendingOutcomes.push(outcome);
      outcomesSinceFlush++;
      publishWorkerRuntime();
      const reachedTargetAfterOutcome =
        countAssetsInCompletedPrefix(checkpoint, rankByListing) >=
        options.targetAssets;
      const mustFlush =
        reachedTargetAfterOutcome ||
        error?.status === 429 ||
        error?.kind === "fatal" ||
        decision.state === "breaker_open";
      if (flushAfterIntegration) {
        await flushProgress(mustFlush, phaseForDecision());
      }
    };

    const nextCandidates = (
      limit: number,
    ): Array<{ candidate: MarketAssetsPriorityCandidate; index: number }> => {
      const selected: Array<{
        candidate: MarketAssetsPriorityCandidate;
        index: number;
      }> = [];
      for (
        let index = nextScanIndex;
        index < queue.candidates.length && selected.length < limit;
        index++
      ) {
        const candidate = queue.candidates[index]!;
        if (
          checkpoint.candidateProgress[candidate.key]?.completed ||
          activeKeys.has(candidate.key)
        ) {
          continue;
        }
        if (hasActiveListings && !activeSet.has(candidate.key)) {
          const progress = checkpoint.candidateProgress[candidate.key] ?? emptyCandidateProgress();
          progress.completed = true;
          progress.exhausted = true;
          checkpoint.candidateProgress[candidate.key] = progress;
          continue;
        }
        selected.push({ candidate, index });
        nextScanIndex = index + 1;
      }
      return selected;
    };

    const reopenDeferredRound = (): number => {
      let reopened = 0;
      let firstIndex = queue.candidates.length;
      queue.candidates.forEach((candidate, index) => {
        const progress = checkpoint.candidateProgress[candidate.key];
        if (
          !progress?.completed ||
          !progress.lastError ||
          progress.consecutiveFailures <= 0 ||
          progress.deferredRecoveryAttempts >=
            MAX_DEFERRED_RECOVERY_ATTEMPTS
        ) {
          return;
        }
        progress.completed = false;
        progress.exhausted = false;
        progress.deferredRecoveryAttempts++;
        recoveryKeys.add(candidate.key);
        firstIndex = Math.min(firstIndex, index);
        reopened++;
      });
      if (reopened > 0) {
        checkpoint.cursorIndex = Math.min(
          checkpoint.cursorIndex,
          firstIndex,
        );
        nextScanIndex = Math.min(nextScanIndex, firstIndex);
      }
      return reopened;
    };

    const dispatchAvailable = async (): Promise<void> => {
      decision = controller.evaluate(demand(), now());
      const capacity = Math.max(
        0,
        decision.dispatchConcurrency - inFlight.size,
      );
      if (capacity <= 0 || blockingError) {
        publishWorkerRuntime();
        return;
      }
      const selected = nextCandidates(capacity);
      if (selected.length === 0) {
        publishWorkerRuntime();
        return;
      }
      await this.loadHistoryHints(
        selected.map(({ candidate }) => candidate),
        historyHints,
      );
      for (const { candidate, index } of selected) {
        const recovery = recoveryKeys.has(candidate.key);
        const dispatchedConcurrency = decision.dispatchConcurrency;
        const abortController = new AbortController();
        const signal = AbortSignal.any([
          abortController.signal,
          shutdownAbortController.signal,
        ]);
        activeKeys.add(candidate.key);
        const promise = this.collectCandidate(
          candidate,
          checkpoint,
          new Set(assetIds),
          options,
          stateKey,
          historyHints.get(candidate.key),
          recovery ||
            (failedAttemptsThisExecution.get(candidate.key) ?? 0) > 0,
          signal,
        ).then((outcome) => {
          outcome.dispatchedConcurrency = dispatchedConcurrency;
          return outcome;
        });
        inFlight.set(candidate.key, {
          candidate,
          index,
          recovery,
          dispatchedConcurrency,
          abortController,
          promise,
        });
      }
      peakInFlightSinceFlush = Math.max(
        peakInFlightSinceFlush,
        inFlight.size,
      );
      publishWorkerRuntime();
    };

    const waitForCircuitBreaker = async (): Promise<void> => {
      const current = now();
      const resumeAt =
        decision.circuitBreaker.resumeAt ?? current + 1_000;
      const waitMs = Math.max(
        1,
        Math.min(30_000, resumeAt - current),
      );
      const phase = phaseForDecision();
      if (phase === "waiting_rate_limit") {
        marketSyncProgressService.waitForRateLimit(waitMs);
      }
      await flushProgress(true, phase);
      await Promise.race([
        sleep(waitMs),
        terminationRequestedPromise,
      ]);
      if (terminationRequested) return;
      pendingBackoffMs += waitMs;
      decision = controller.evaluate(demand(), now());
      syncControllerCheckpoint();
      publishWorkerRuntime();
    };

    const takeNextOutcome = async (
      flushAfterIntegration = true,
    ): Promise<void> => {
      const outcome = await Promise.race(
        [...inFlight.values()].map(({ promise }) => promise),
      );
      const entry = inFlight.get(outcome.candidate.key);
      if (!entry) {
        throw new Error(
          `El dispatcher perdió el worker de "${outcome.candidate.marketHashName}".`,
        );
      }
      inFlight.delete(outcome.candidate.key);
      activeKeys.delete(outcome.candidate.key);
      await integrateOutcome(
        outcome,
        entry.index,
        entry.recovery,
        flushAfterIntegration,
      );
    };

    const drainInFlight = async (): Promise<void> => {
      const entries = [...inFlight.values()];
      if (entries.length === 0) return;
      for (const entry of entries) entry.abortController.abort();
      const settled = await Promise.allSettled(
        entries.map(({ promise }) => promise),
      );
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]!;
        const result = settled[index]!;
        inFlight.delete(entry.candidate.key);
        activeKeys.delete(entry.candidate.key);
        if (result.status === "rejected") {
          console.error(
            `[Market Assets Sync] Worker "${entry.candidate.marketHashName}" falló mientras se drenaba:`,
            result.reason,
          );
          continue;
        }
        try {
          await integrateOutcome(
            result.value,
            entry.index,
            entry.recovery,
            false,
          );
        } catch (error) {
          console.error(
            `[Market Assets Sync] No se pudo integrar "${entry.candidate.marketHashName}" durante el drenaje:`,
            error,
          );
        }
      }
    };

    const unregisterShutdown =
      marketAssetsShutdownCoordinator.register(async (reason) => {
        if (!terminationRequested) {
          terminationRequested = true;
          stopRequest.reason = reason;
          shutdownAbortController.abort();
          notifyTerminationRequested();
        }
        await shutdownCompletedPromise;
      });

    try {
      for (;;) {
        advanceCursor(checkpoint, queue);
        const prefixAssetCount = publishableAssetCount();

        if (terminationRequested) {
          if (inFlight.size === 0) {
            throw stopRequest.reason === "user_cancelled"
              ? new MarketAssetsSyncCancelledError()
              : new MarketAssetsCollectionInterruptedError();
          }
          await takeNextOutcome(false);
          continue;
        }

        if (blockingError && inFlight.size === 0) {
          throw blockingError;
        }

        const reachedTarget = prefixAssetCount >= options.targetAssets;
        const exhaustedNormalQueue =
          checkpoint.cursorIndex >= queue.candidates.length;
        if (reachedTarget && inFlight.size > 0) {
          // Ya existe un prefijo de prioridad suficiente. No se abren listings
          // inferiores. Se cancelan únicamente los requests de menor prioridad;
          // una respuesta que ganó la carrera antes del abort igualmente se
          // integra antes del recorte final.
          for (const entry of inFlight.values()) {
            if (entry.index >= checkpoint.cursorIndex) {
              entry.abortController.abort();
            }
          }
          await takeNextOutcome();
          continue;
        }
        if (inFlight.size === 0 && (reachedTarget || exhaustedNormalQueue)) {
          if (reachedTarget) {
            await flushProgress(true);
            break;
          }

          decision = controller.evaluate(demand(), now());
          if (decision.dispatchConcurrency === 0) {
            await waitForCircuitBreaker();
            continue;
          }

          const reopened = reopenDeferredRound();
          if (reopened > 0) {
            // El número de ronda queda durable antes de volver a abrir hasta
            // `concurrency` requests. Un reinicio no regala intentos extra.
            await flushProgress(true);
            continue;
          }

          const unresolvedIndex = queue.candidates.findIndex((candidate) => {
            const progress = checkpoint.candidateProgress[candidate.key];
            return Boolean(
              progress?.lastError && progress.consecutiveFailures > 0,
            );
          });
          if (unresolvedIndex >= 0) {
            const candidate = queue.candidates[unresolvedIndex]!;
            const progress = checkpoint.candidateProgress[candidate.key]!;
            progress.completed = false;
            progress.exhausted = false;
            checkpoint.cursorIndex = Math.min(
              checkpoint.cursorIndex,
              unresolvedIndex,
            );
            nextScanIndex = Math.min(nextScanIndex, unresolvedIndex);
            blockingError =
              lastRetryableErrors.get(candidate.key) ??
              new MarketAssetsApiError(
                progress.lastError ??
                  `No se pudo recuperar "${candidate.marketHashName}".`,
                "retryable",
                0,
                0,
              );
            throw blockingError;
          }

          await flushProgress(true);
          break;
        }

        decision = controller.evaluate(demand(), now());
        if (
          decision.dispatchConcurrency === 0 &&
          inFlight.size === 0
        ) {
          await waitForCircuitBreaker();
          continue;
        }

        await dispatchAvailable();
        if (inFlight.size === 0) {
          throw new Error(
            "El checkpoint no puede avanzar aunque quedan candidatos incompletos.",
          );
        }

        await takeNextOutcome();
      }
    } catch (error) {
      shutdownAbortController.abort();
      await drainInFlight();
      try {
        await flushProgress(true, "paused");
      } catch (flushError) {
        console.error(
          "[Market Assets Sync] Falló el checkpoint final después de detener el dispatcher:",
          flushError,
        );
      }
      throw error;
    } finally {
      unregisterShutdown();
      notifyShutdownCompleted();
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
          effectiveConcurrency: outcome.dispatchedConcurrency,
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
    signal?: AbortSignal,
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
    const requestSamples: MarketAssetRequestCompletion[] = [];
    let previousFullPageFingerprint: string | null = null;

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
      requestSamples,
      dispatchedConcurrency: 1,
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
          ...(signal ? { signal } : {}),
          onRateLimitWait: (waitMs) => {
            // La duración global se deriva de MarketSyncPhaseMetric. Sumar
            // este callback por cada worker multiplicaba una sola espera por
            // hasta 48 y producía horas ficticias en la telemetría.
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
        progress.lastError = null;
        progress.providerTotal = Math.max(
          progress.providerTotal,
          page.providerTotal,
        );
        progress.rawAssetCount += page.assets.length;

        const normalized: NormalizedMarketAssetsBatch =
          this.snapshotBuilder.normalizeMany(page.assets, candidate);
        progress.skippedAssetCount += normalized.skippedRows;
        const validBeforePage = progress.validAssetCount;
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
        const validAssetsOnPage = Math.max(
          0,
          progress.validAssetCount - validBeforePage,
        );
        const fullPageFingerprint =
          page.assets.length >= pageLimit
            ? rawAssetPageFingerprint(page.assets)
            : null;
        if (
          validAssetsOnPage === 0 &&
          fullPageFingerprint != null &&
          fullPageFingerprint === previousFullPageFingerprint
        ) {
          const repeatedPageError = new MarketAssetsApiError(
            `SteamWebAPI repitió la misma página para "${candidate.marketHashName}" sin permitir avanzar.`,
            "retryable",
            502,
            0,
            0,
            0,
            Math.max(0, Number(page.durationMs) || 0),
            "http_transient",
          );
          httpSucceeded = Math.max(0, httpSucceeded - attempts);
          httpFailed += attempts;
          progress.lastError = repeatedPageError.message;
          progress.consecutiveFailures++;
          requestSamples.push({
            outcome: "server_error",
            completedAt: this.runtime.now?.() ?? Date.now(),
            latencyMs: Math.max(0, Number(page.durationMs) || 0),
            validAssets: 0,
          });
          return result(repeatedPageError);
        }
        previousFullPageFingerprint = fullPageFingerprint;
        requestSamples.push({
          outcome: "success",
          completedAt: this.runtime.now?.() ?? Date.now(),
          latencyMs: Math.max(0, Number(page.durationMs) || 0),
          validAssets: validAssetsOnPage,
        });

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
        const attempts = Math.max(0, apiError.httpAttempts);
        httpAttempts += attempts;
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
        if (apiError.failureKind === "cancelled") {
          progress.lastError = null;
          progress.consecutiveFailures = 0;
          return result(apiError);
        }
        httpFailed += attempts;
        const completedAt = this.runtime.now?.() ?? Date.now();
        const failureOutcome: MarketAssetRequestOutcome =
          apiError.kind === "candidate"
            ? "candidate_error"
            : apiError.status === 429
              ? "rate_limited"
              : apiError.kind === "fatal"
                ? "fatal"
                : apiError.failureKind === "timeout"
                  ? "timeout"
                  : apiError.failureKind === "http_transient" ||
                      apiError.status >= 500
                    ? "server_error"
                    : "network_error";
        if (failureOutcome === "rate_limited") {
          const rateLimit = floatRateLimiter.getSnapshot();
          requestSamples.push({
            outcome: "rate_limited",
            completedAt,
            latencyMs: Math.max(0, apiError.durationMs),
            validAssets: 0,
            resumeAt: Math.max(
              completedAt + 1_000,
              rateLimit.cooldownUntil,
            ),
          });
        } else {
          requestSamples.push({
            outcome: failureOutcome,
            completedAt,
            latencyMs: Math.max(0, apiError.durationMs),
            validAssets: 0,
          });
        }

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
    if (progress.completed) {
      progress.deferredRecoveryAttempts = 0;
    }
    return result(null);
  }
}
