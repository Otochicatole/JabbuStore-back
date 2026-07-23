export type MarketSyncRunStatus =
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed";

export type MarketSyncEtaConfidence =
  | "high"
  | "medium"
  | "low"
  | "unavailable";

export type MarketSyncCircuitBreakerState =
  | "closed"
  | "open"
  | "half_open";

export type MarketSyncSlowReason =
  | "quota_wait"
  | "provider_latency"
  | "timeouts"
  | "retries"
  | "empty_catalog_results"
  | "adaptive_concurrency"
  | "paused"
  | "publishing_database"
  | "none";

export interface MarketSyncPhaseMetricRecord {
  phase: string;
  durationMs: number;
  entryCount: number;
  lastEnteredAt: Date | null;
}

export interface MarketSyncRunRecord {
  id: string;
  stateKey: string;
  status: MarketSyncRunStatus;
  initialTriggeredBy: string | null;
  latestTriggeredBy: string | null;
  recoveryKind: string;
  resumedFromRecovery: boolean;
  currentPhase: string;
  runStartedAt: Date;
  latestAttemptStartedAt: Date;
  latestAttemptFinishedAt: Date | null;
  runFinishedAt: Date | null;
  lastHeartbeatAt: Date;
  phaseStartedAt: Date;
  metricsFlushedAt: Date;
  attemptCount: number;
  activeDurationMs: number;
  pausedDurationMs: number;
  quotaWaitDurationMs: number;
  retryBackoffDurationMs: number;
  pageRequests: number;
  httpAttempts: number;
  httpSucceeded: number;
  httpFailed: number;
  retryCount: number;
  timeoutCount: number;
  emptyResponseCount: number;
  notFoundCount: number;
  rateLimitedCount: number;
  quotaWaitCount: number;
  latencySampleCount: number;
  latencyTotalMs: number;
  latencyMaximumMs: number;
  latencyLe250Count: number;
  latencyLe1000Count: number;
  latencyLe3000Count: number;
  latencyLe10000Count: number;
  latencyLe30000Count: number;
  latencyGt30000Count: number;
  runQuotaUnitsUsed: number;
  creditsUsed: number;
  configuredConcurrency: number;
  currentConcurrency: number;
  minimumConcurrencyUsed: number;
  peakInFlight: number;
  concurrencyReductionCount: number;
  concurrencyIncreaseCount: number;
  deferredCandidateCount: number;
  throughputWindowStartedAt: Date | null;
  throughputWindowStartValidAssets: number;
  recentValidAssetsPerMinute: number | null;
  targetAssets: number;
  assetsPerItem: number;
  totalCandidates: number;
  candidatesVisited: number;
  rawAssetCount: number;
  validAssetCount: number;
  skippedAssetCount: number;
  publishedListingCount: number;
  publishedFloatCount: number;
  snapshotHash: string | null;
  completionReason: string | null;
  lastError: string | null;
  phases: MarketSyncPhaseMetricRecord[];
}

export interface MarketSyncTelemetryDelta {
  pageRequests?: number | undefined;
  httpAttempts?: number | undefined;
  httpSucceeded?: number | undefined;
  httpFailed?: number | undefined;
  retryCount?: number | undefined;
  timeoutCount?: number | undefined;
  emptyResponseCount?: number | undefined;
  notFoundCount?: number | undefined;
  rateLimitedCount?: number | undefined;
  quotaWaitCount?: number | undefined;
  quotaWaitDurationMs?: number | undefined;
  retryBackoffDurationMs?: number | undefined;
  requestLatenciesMs?: readonly number[] | undefined;
  runQuotaUnitsUsed?: number | undefined;
  creditsUsed?: number | undefined;
  currentConcurrency?: number | undefined;
  minimumConcurrencyUsed?: number | undefined;
  peakInFlight?: number | undefined;
  concurrencyReductionCount?: number | undefined;
  concurrencyIncreaseCount?: number | undefined;
  deferredCandidateCount?: number | undefined;
}

export interface MarketSyncRunProgress {
  phase?: string | undefined;
  targetAssets?: number | undefined;
  assetsPerItem?: number | undefined;
  totalCandidates?: number | undefined;
  candidatesVisited?: number | undefined;
  rawAssetCount?: number | undefined;
  validAssetCount?: number | undefined;
  skippedAssetCount?: number | undefined;
  publishedListingCount?: number | undefined;
  publishedFloatCount?: number | undefined;
  snapshotHash?: string | null | undefined;
  completionReason?: string | null | undefined;
  telemetry?: MarketSyncTelemetryDelta | undefined;
}

export interface StartMarketSyncRunAttemptInput {
  stateKey: string;
  triggeredBy: string;
  phase: string;
  targetAssets: number;
  assetsPerItem: number;
  configuredConcurrency: number;
  initialConcurrency?: number;
  recoveryRequested: boolean;
  recoveryKind?: string;
}

export interface FinishMarketSyncRunInput {
  error?: string | null;
  resumable?: boolean;
  completionReason?: string | null;
}

export interface IMarketSyncRunRepository {
  startAttempt(input: StartMarketSyncRunAttemptInput): Promise<MarketSyncRunRecord>;
  getCurrentOrLast(stateKey: string): Promise<MarketSyncRunRecord | null>;
  recordProgress(stateKey: string, progress: MarketSyncRunProgress): Promise<void>;
  recordTelemetry(stateKey: string, delta: MarketSyncTelemetryDelta): Promise<void>;
  heartbeat(stateKey: string): Promise<void>;
  complete(stateKey: string, input?: FinishMarketSyncRunInput): Promise<void>;
  finishAttempt(stateKey: string, input: FinishMarketSyncRunInput): Promise<void>;
  /** Retorna false si ya no existía una corrida activa para cerrar. */
  cancel(stateKey: string, message: string): Promise<boolean>;
  prune(stateKey: string, retainRuns?: number): Promise<number>;
}

export interface MarketSyncRunStatusView {
  id: string;
  status: MarketSyncRunStatus;
  resumed: boolean;
  attemptCount: number;
  runStartedAt: string;
  attemptStartedAt: string;
  runFinishedAt: string | null;
  lastHeartbeatAt: string;
  elapsed: {
    wallMs: number;
    activeMs: number;
    pausedMs: number;
    quotaWaitMs: number;
    retryBackoffMs: number;
  };
  phases: Array<{
    phase: string;
    durationMs: number;
    entryCount: number;
    current: boolean;
  }>;
  requests: {
    pages: number;
    attempts: number;
    succeeded: number;
    failed: number;
    retries: number;
    timeouts: number;
    emptyResponses: number;
    notFound: number;
    rateLimited: number;
    latencyMs: {
      samples: number;
      average: number | null;
      maximum: number | null;
      p95Approx: number | null;
    };
  };
  quota: {
    runUnitsUsed: number;
    creditsUsed: number;
    windowUnitsUsed: number;
    limit: number;
    resetsAt: string | null;
    waitCount: number;
  };
  concurrency: {
    configured: number;
    current: number;
    minimumUsed: number;
    peakInFlight: number;
    reductions: number;
  };
  throughput: {
    validAssetsPerMinute: number | null;
    etaSeconds: number | null;
    etaConfidence: MarketSyncEtaConfidence;
    targetDurationSeconds: number;
    requiredAssetsPerMinute: number;
    onTrack: boolean | null;
    projectedCompletionAt: string | null;
  };
  workers: {
    initial: number;
    max: number;
    effective: number;
    required: number;
    inFlight: number;
    queueDepth: number;
    /** Fracción entre 0 y 1 de los slots efectivos que están ocupados. */
    utilization: number;
  };
  circuitBreaker: {
    state: MarketSyncCircuitBreakerState;
    openCount: number;
    resumeAt: string | null;
  };
  requestPacer: {
    initialStartsPerSecond: number;
    maximumStartsPerSecond: number;
    currentStartsPerSecond: number;
    queued: number;
    gateState: "closed" | "open";
    gateReason: "congestion" | "rate_limited" | null;
    gateResumeAt: string | null;
  } | null;
  slowReason: MarketSyncSlowReason;
  recommendedPollAfterMs: number;
  deferredCandidateCount: number;
  warnings: string[];
}
