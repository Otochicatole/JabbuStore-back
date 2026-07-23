import { describe, expect, it } from "vitest";
import type { MarketSyncRunRecord } from "../../domain/MarketSyncRun";
import { buildMarketSyncRunStatusView } from "../MarketSyncRunStatusView";

function run(overrides: Partial<MarketSyncRunRecord> = {}): MarketSyncRunRecord {
  const start = new Date("2026-07-21T12:00:00.000Z");
  return {
    id: "run-1",
    stateKey: "youpin-assets-snapshot",
    status: "running",
    initialTriggeredBy: "manual",
    latestTriggeredBy: "manual",
    recoveryKind: "none",
    resumedFromRecovery: false,
    currentPhase: "collecting_assets",
    runStartedAt: start,
    latestAttemptStartedAt: start,
    latestAttemptFinishedAt: null,
    runFinishedAt: null,
    lastHeartbeatAt: new Date("2026-07-21T12:00:15.000Z"),
    phaseStartedAt: start,
    metricsFlushedAt: new Date("2026-07-21T12:00:15.000Z"),
    attemptCount: 1,
    activeDurationMs: 15_000,
    pausedDurationMs: 0,
    quotaWaitDurationMs: 0,
    retryBackoffDurationMs: 0,
    pageRequests: 10,
    httpAttempts: 10,
    httpSucceeded: 10,
    httpFailed: 0,
    retryCount: 0,
    timeoutCount: 0,
    emptyResponseCount: 0,
    notFoundCount: 0,
    rateLimitedCount: 0,
    quotaWaitCount: 0,
    latencySampleCount: 10,
    latencyTotalMs: 20_000,
    latencyMaximumMs: 3_500,
    latencyLe250Count: 0,
    latencyLe1000Count: 1,
    latencyLe3000Count: 8,
    latencyLe10000Count: 1,
    latencyLe30000Count: 0,
    latencyGt30000Count: 0,
    runQuotaUnitsUsed: 100,
    creditsUsed: 1.5,
    configuredConcurrency: 3,
    currentConcurrency: 3,
    minimumConcurrencyUsed: 3,
    peakInFlight: 3,
    concurrencyReductionCount: 0,
    concurrencyIncreaseCount: 0,
    deferredCandidateCount: 0,
    throughputWindowStartedAt: start,
    throughputWindowStartValidAssets: 0,
    recentValidAssetsPerMinute: 120,
    targetAssets: 1_000,
    assetsPerItem: 10,
    totalCandidates: 100,
    candidatesVisited: 50,
    rawAssetCount: 500,
    validAssetCount: 500,
    skippedAssetCount: 0,
    publishedListingCount: 0,
    publishedFloatCount: 0,
    snapshotHash: null,
    completionReason: null,
    lastError: null,
    phases: [
      {
        phase: "collecting_assets",
        durationMs: 15_000,
        entryCount: 1,
        lastEnteredAt: start,
      },
    ],
    ...overrides,
  };
}

describe("buildMarketSyncRunStatusView", () => {
  it("separa wall, activo durable y delta vivo sin exponer BigInt", () => {
    const status = buildMarketSyncRunStatusView(run(), {
      now: new Date("2026-07-21T12:00:20.000Z"),
      validAssets: 500,
      targetAssets: 1_000,
      windowQuotaUnitsUsed: 100,
      quotaLimit: 10_000,
      quotaResetsAt: null,
    });

    expect(status.elapsed).toMatchObject({ wallMs: 20_000, activeMs: 20_000 });
    expect(status.phases[0]?.durationMs).toBe(20_000);
    expect(status.requests.latencyMs).toEqual({
      samples: 10,
      average: 2_000,
      maximum: 3_500,
      p95Approx: 10_000,
    });
    expect(status.quota.runUnitsUsed).toBe(100);
    expect(status.quota.creditsUsed).toBe(1.5);
  });

  it("calcula ETA con la ventana reciente y recomienda 5s al recolectar", () => {
    const status = buildMarketSyncRunStatusView(
      run({
        activeDurationMs: 60_000,
        metricsFlushedAt: new Date("2026-07-21T12:01:00.000Z"),
        lastHeartbeatAt: new Date("2026-07-21T12:01:00.000Z"),
        phases: [
          {
            phase: "collecting_assets",
            durationMs: 60_000,
            entryCount: 1,
            lastEnteredAt: new Date("2026-07-21T12:00:00.000Z"),
          },
        ],
      }),
      {
        now: new Date("2026-07-21T12:01:00.000Z"),
        validAssets: 500,
        targetAssets: 1_000,
        windowQuotaUnitsUsed: 100,
        quotaLimit: 10_000,
        quotaResetsAt: null,
      },
    );

    expect(status.throughput).toMatchObject({
      validAssetsPerMinute: 120,
      etaSeconds: 250,
      etaConfidence: "high",
      targetDurationSeconds: 600,
      onTrack: true,
      projectedCompletionAt: "2026-07-21T12:05:10.000Z",
    });
    expect(status.throughput.requiredAssetsPerMinute).toBe(55.6);
    expect(status.recommendedPollAfterMs).toBe(5_000);
  });

  it("expone workers, breaker y advierte cuando el objetivo de diez minutos no es viable", () => {
    const status = buildMarketSyncRunStatusView(
      run({
        configuredConcurrency: 48,
        currentConcurrency: 21,
        recentValidAssetsPerMinute: 120,
        targetAssets: 10_000,
        validAssetCount: 1_000,
        totalCandidates: 2_000,
        candidatesVisited: 200,
      }),
      {
        now: new Date("2026-07-21T12:08:00.000Z"),
        validAssets: 1_000,
        targetAssets: 10_000,
        windowQuotaUnitsUsed: 100,
        quotaLimit: 10_000,
        quotaResetsAt: null,
        workers: {
          initial: 6,
          max: 48,
          effective: 21,
          inFlight: 20,
          queueDepth: 1_780,
        },
        circuitBreaker: {
          state: "open",
          openCount: 2,
          resumeAt: "2026-07-21T12:08:45.000Z",
        },
        targetDurationSeconds: 600,
        targetDeadlineAt: "2026-07-21T12:10:00.000Z",
      },
    );

    expect(status.workers).toEqual({
      initial: 6,
      max: 48,
      effective: 21,
      required: 48,
      inFlight: 20,
      queueDepth: 1_780,
      utilization: 0.952,
    });
    expect(status.circuitBreaker).toEqual({
      state: "open",
      openCount: 2,
      resumeAt: "2026-07-21T12:08:45.000Z",
    });
    expect(status.throughput).toMatchObject({
      targetDurationSeconds: 600,
      requiredAssetsPerMinute: 4_500,
      onTrack: false,
    });
    expect(status.warnings).toContain("ten_minute_target_unreachable");
  });

  it("muestra la pausa viva desde el ultimo intento", () => {
    const status = buildMarketSyncRunStatusView(
      run({
        status: "paused",
        currentPhase: "paused",
        latestAttemptFinishedAt: new Date("2026-07-21T12:00:20.000Z"),
        lastHeartbeatAt: new Date("2026-07-21T12:00:20.000Z"),
        pausedDurationMs: 3_000,
      }),
      {
        now: new Date("2026-07-21T12:00:30.000Z"),
        validAssets: 500,
        targetAssets: 1_000,
        windowQuotaUnitsUsed: 0,
        quotaLimit: 10_000,
        quotaResetsAt: null,
      },
    );

    expect(status.resumed).toBe(false);
    expect(status.elapsed.pausedMs).toBe(13_000);
    expect(status.slowReason).toBe("paused");
    expect(status.recommendedPollAfterMs).toBe(10_000);
  });
});
