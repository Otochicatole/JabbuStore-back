import type {
  MarketSyncCircuitBreakerState,
  MarketSyncEtaConfidence,
  MarketSyncRunRecord,
  MarketSyncRunStatusView,
  MarketSyncSlowReason,
} from "../domain/MarketSyncRun";

export interface MarketSyncRunStatusContext {
  now?: Date;
  validAssets: number;
  targetAssets: number;
  windowQuotaUnitsUsed: number;
  quotaLimit: number;
  quotaResetsAt: string | null;
  workers?: {
    initial?: number | undefined;
    max?: number | undefined;
    effective?: number | undefined;
    required?: number | undefined;
    inFlight?: number | undefined;
    queueDepth?: number | undefined;
  };
  circuitBreaker?: {
    state: MarketSyncCircuitBreakerState;
    openCount: number;
    resumeAt: string | null;
  };
  targetDurationSeconds?: number;
  targetDeadlineAt?: string | null;
  tenMinuteTargetUnreachable?: boolean;
}

function duration(from: Date, to: Date): number {
  return Math.max(0, to.getTime() - from.getTime());
}

function approximateP95(run: MarketSyncRunRecord): number | null {
  if (run.latencySampleCount <= 0) return null;
  const target = Math.ceil(run.latencySampleCount * 0.95);
  let cumulative = 0;
  const buckets: Array<[number, number]> = [
    [250, run.latencyLe250Count],
    [1_000, run.latencyLe1000Count],
    [3_000, run.latencyLe3000Count],
    [10_000, run.latencyLe10000Count],
    [30_000, run.latencyLe30000Count],
    [Math.max(30_001, run.latencyMaximumMs), run.latencyGt30000Count],
  ];
  for (const [upperBound, count] of buckets) {
    cumulative += count;
    if (cumulative >= target) return upperBound;
  }
  return run.latencyMaximumMs || null;
}

function pollingDelay(
  run: MarketSyncRunRecord,
  quotaResetsAt: string | null,
  now: Date,
): number {
  if (run.status === "paused") return 10_000;
  if (run.status !== "running") return 30_000;
  if (run.currentPhase !== "waiting_rate_limit") {
    return run.currentPhase === "collecting_assets" ||
      run.currentPhase === "building_priority_queue"
      ? 5_000
      : 2_000;
  }
  const reset = quotaResetsAt ? Date.parse(quotaResetsAt) : Number.NaN;
  if (!Number.isFinite(reset)) return 10_000;
  return Math.min(30_000, Math.max(5_000, reset - now.getTime() + 250));
}

function slowReason(input: {
  run: MarketSyncRunRecord;
  activeMs: number;
  averageLatency: number | null;
  p95: number | null;
}): MarketSyncSlowReason {
  const { run, activeMs, averageLatency, p95 } = input;
  const attempts = Math.max(1, run.httpAttempts);
  if (run.status === "paused") return "paused";
  if (run.currentPhase === "publishing_database") return "publishing_database";
  if (
    run.currentPhase === "waiting_rate_limit" ||
    (activeMs > 0 && run.quotaWaitDurationMs / activeMs >= 0.25)
  ) {
    return "quota_wait";
  }
  if (run.timeoutCount / attempts >= 0.1) return "timeouts";
  if (run.retryCount / attempts >= 0.15) return "retries";
  if ((run.emptyResponseCount + run.notFoundCount) / attempts >= 0.3) {
    return "empty_catalog_results";
  }
  if (
    run.concurrencyReductionCount > 0 ||
    (run.configuredConcurrency > 0 &&
      run.currentConcurrency < run.configuredConcurrency)
  ) {
    return "adaptive_concurrency";
  }
  if ((averageLatency ?? 0) >= 5_000 || (p95 ?? 0) >= 10_000) {
    return "provider_latency";
  }
  return "none";
}

export function buildMarketSyncRunStatusView(
  run: MarketSyncRunRecord,
  context: MarketSyncRunStatusContext,
): MarketSyncRunStatusView {
  const now = context.now ?? new Date();
  const liveActiveDelta =
    run.status === "running" ? duration(run.metricsFlushedAt, now) : 0;
  const activeMs = run.activeDurationMs + liveActiveDelta;
  const livePausedDelta =
    run.status === "paused"
      ? duration(run.latestAttemptFinishedAt ?? run.lastHeartbeatAt, now)
      : 0;
  const pausedMs = run.pausedDurationMs + livePausedDelta;
  const wallEnd = run.runFinishedAt ?? now;
  const wallMs = duration(run.runStartedAt, wallEnd);

  const phases = run.phases.map((phase) => ({
    phase: phase.phase,
    durationMs:
      phase.durationMs +
      (run.status === "running" && phase.phase === run.currentPhase
        ? liveActiveDelta
        : 0),
    entryCount: phase.entryCount,
    current: run.status === "running" && phase.phase === run.currentPhase,
  }));
  const collectingMs =
    phases.find((phase) => phase.phase === "collecting_assets")?.durationMs ?? 0;
  const validAssets = Math.max(context.validAssets, run.validAssetCount);
  const targetAssets = Math.max(context.targetAssets, run.targetAssets);
  const validAssetsPerMinute =
    run.httpAttempts >= 5 &&
    run.recentValidAssetsPerMinute != null &&
    run.recentValidAssetsPerMinute >= 0
      ? run.recentValidAssetsPerMinute
      : null;
  const remaining = Math.max(0, targetAssets - validAssets);
  const etaSeconds =
    remaining === 0
      ? 0
      : run.status === "running" &&
          validAssetsPerMinute != null &&
          validAssetsPerMinute > 0
        ? Math.ceil((remaining / validAssetsPerMinute) * 60 - 1e-9)
        : null;
  const targetDurationSeconds = Math.max(
    1,
    Math.trunc(context.targetDurationSeconds ?? 600),
  );
  const parsedDeadline = context.targetDeadlineAt
    ? Date.parse(context.targetDeadlineAt)
    : Number.NaN;
  const targetDeadlineMs = Number.isFinite(parsedDeadline)
    ? parsedDeadline
    : run.runStartedAt.getTime() + targetDurationSeconds * 1_000;
  const secondsUntilTarget = Math.max(
    1,
    Math.ceil((targetDeadlineMs - now.getTime()) / 1_000),
  );
  const requiredAssetsPerMinute =
    remaining === 0
      ? 0
      : Math.round((remaining / secondsUntilTarget) * 600) / 10;
  const projectedCompletionAt =
    etaSeconds == null
      ? null
      : new Date(now.getTime() + etaSeconds * 1_000).toISOString();
  const targetIsUnreachable =
    Boolean(context.tenMinuteTargetUnreachable) ||
    (remaining > 0 && now.getTime() >= targetDeadlineMs) ||
    (projectedCompletionAt != null &&
      Date.parse(projectedCompletionAt) > targetDeadlineMs);
  const onTrack =
    remaining === 0
      ? true
      : targetIsUnreachable
        ? false
        : projectedCompletionAt == null
          ? null
          : Date.parse(projectedCompletionAt) <= targetDeadlineMs;
  let etaConfidence: MarketSyncEtaConfidence = "unavailable";
  if (etaSeconds != null && remaining > 0) {
    const timeoutRatio = run.timeoutCount / Math.max(1, run.httpAttempts);
    if (validAssets >= 500 && collectingMs >= 60_000 && timeoutRatio < 0.05) {
      etaConfidence = "high";
    } else if (validAssets >= 100 && collectingMs >= 30_000) {
      etaConfidence = "medium";
    } else {
      etaConfidence = "low";
    }
  }

  const averageLatency =
    run.latencySampleCount > 0
      ? Math.round(run.latencyTotalMs / run.latencySampleCount)
      : null;
  const p95 = approximateP95(run);
  const warnings: string[] = [];
  if (duration(run.lastHeartbeatAt, now) > 15_000 && run.status === "running") {
    warnings.push("heartbeat_stale");
  }
  if (run.httpAttempts > 0 && run.timeoutCount / run.httpAttempts >= 0.1) {
    warnings.push("high_timeout_rate");
  }
  if (run.deferredCandidateCount > 0) warnings.push("deferred_candidates");
  if (etaConfidence === "low") warnings.push("eta_low_confidence");
  if (
    context.quotaLimit > 0 &&
    context.windowQuotaUnitsUsed / context.quotaLimit >= 0.9
  ) {
    warnings.push("quota_window_near_limit");
  }
  if (targetIsUnreachable) warnings.push("ten_minute_target_unreachable");

  const maximumWorkers = Math.max(
    0,
    Math.trunc(context.workers?.max ?? run.configuredConcurrency),
  );
  const effectiveWorkers = Math.min(
    maximumWorkers,
    Math.max(
      0,
      Math.trunc(context.workers?.effective ?? run.currentConcurrency),
    ),
  );
  const initialWorkers = Math.min(
    maximumWorkers,
    Math.max(
      0,
      Math.trunc(
        context.workers?.initial ??
          Math.min(6, maximumWorkers),
      ),
    ),
  );
  const inFlightWorkers = Math.min(
    effectiveWorkers,
    Math.max(0, Math.trunc(context.workers?.inFlight ?? 0)),
  );
  const estimatedRequiredWorkers =
    remaining === 0
      ? 0
      : validAssetsPerMinute != null &&
          validAssetsPerMinute > 0 &&
          effectiveWorkers > 0
        ? Math.ceil(
            (requiredAssetsPerMinute /
              (validAssetsPerMinute / effectiveWorkers)) *
              1.15,
          )
        : initialWorkers;
  const requiredWorkers = Math.min(
    maximumWorkers,
    Math.max(
      remaining === 0 ? 0 : 1,
      Math.trunc(context.workers?.required ?? estimatedRequiredWorkers),
    ),
  );
  const queueDepth = Math.max(
    0,
    Math.trunc(
      context.workers?.queueDepth ??
        Math.max(0, run.totalCandidates - run.candidatesVisited),
    ),
  );

  return {
    id: run.id,
    status: run.status,
    resumed: run.resumedFromRecovery || run.attemptCount > 1,
    attemptCount: run.attemptCount,
    runStartedAt: run.runStartedAt.toISOString(),
    attemptStartedAt: run.latestAttemptStartedAt.toISOString(),
    runFinishedAt: run.runFinishedAt?.toISOString() ?? null,
    lastHeartbeatAt: run.lastHeartbeatAt.toISOString(),
    elapsed: {
      wallMs,
      activeMs,
      pausedMs,
      quotaWaitMs: run.quotaWaitDurationMs,
      retryBackoffMs: run.retryBackoffDurationMs,
    },
    phases,
    requests: {
      pages: run.pageRequests,
      attempts: run.httpAttempts,
      succeeded: run.httpSucceeded,
      failed: run.httpFailed,
      retries: run.retryCount,
      timeouts: run.timeoutCount,
      emptyResponses: run.emptyResponseCount,
      notFound: run.notFoundCount,
      rateLimited: run.rateLimitedCount,
      latencyMs: {
        samples: run.latencySampleCount,
        average: averageLatency,
        maximum:
          run.latencySampleCount > 0 ? run.latencyMaximumMs : null,
        p95Approx: p95,
      },
    },
    quota: {
      runUnitsUsed: run.runQuotaUnitsUsed,
      creditsUsed: run.creditsUsed,
      windowUnitsUsed: context.windowQuotaUnitsUsed,
      limit: context.quotaLimit,
      resetsAt: context.quotaResetsAt,
      waitCount: run.quotaWaitCount,
    },
    concurrency: {
      configured: run.configuredConcurrency,
      current: run.currentConcurrency,
      minimumUsed: run.minimumConcurrencyUsed,
      peakInFlight: run.peakInFlight,
      reductions: run.concurrencyReductionCount,
    },
    throughput: {
      validAssetsPerMinute:
        validAssetsPerMinute == null
          ? null
          : Math.round(validAssetsPerMinute * 10) / 10,
      etaSeconds,
      etaConfidence,
      targetDurationSeconds,
      requiredAssetsPerMinute,
      onTrack,
      projectedCompletionAt,
    },
    workers: {
      initial: initialWorkers,
      max: maximumWorkers,
      effective: effectiveWorkers,
      required: requiredWorkers,
      inFlight: inFlightWorkers,
      queueDepth,
      utilization:
        effectiveWorkers > 0
          ? Math.round((inFlightWorkers / effectiveWorkers) * 1_000) / 1_000
          : 0,
    },
    circuitBreaker: context.circuitBreaker ?? {
      state: "closed",
      openCount: 0,
      resumeAt: null,
    },
    slowReason: slowReason({ run, activeMs, averageLatency, p95 }),
    recommendedPollAfterMs: pollingDelay(run, context.quotaResetsAt, now),
    deferredCandidateCount: run.deferredCandidateCount,
    warnings,
  };
}
