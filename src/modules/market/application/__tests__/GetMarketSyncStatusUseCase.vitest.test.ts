import { describe, expect, it, vi } from "vitest";

vi.mock("../FloatRateLimiter", () => ({
  floatRateLimiter: {
    getDurableSnapshot: vi.fn(async () => ({
      quotaUnitsUsed: 120,
      effectiveCapacity: 10_000,
      windowResetsAt: Date.now() + 60_000,
    })),
    getSnapshot: vi.fn(),
  },
}));

import { GetMarketSyncStatusUseCase } from "../GetMarketSyncStatusUseCase";

const hash = "a".repeat(64);

function store() {
  return {
    getStatus: vi.fn(async () => ({
      exists: true,
      version: hash,
      fetchedAt: new Date(0).toISOString(),
      requestedLimit: 10_000,
      rawAssetCount: 10,
      validAssetCount: 10,
      skippedAssetCount: 0,
      completionReason: "catalog_exhausted",
    })),
    getCheckpointStatus: vi.fn(async () => ({
      exists: false,
      targetAssets: 10_000,
      validAssetCount: 0,
      rawAssetCount: 0,
      skippedAssetCount: 0,
      candidatesVisited: 0,
      totalCandidates: 0,
      creditsUsed: 0,
    })),
  };
}

function publishedState(overrides: Record<string, unknown> = {}) {
  return {
    lastPublishedSnapshotHash: hash,
    lastPublishedRawAssetCount: 10,
    lastPublishedValidAssetCount: 10,
    lastPublishedSkippedAssetCount: 0,
    lastPublishedListingCount: 1,
    lastPublishedFloatCount: 10,
    lastPublishedAt: new Date(0),
    lastSuccessfulAt: new Date(0),
    lastStartedAt: new Date(0),
    lastFinishedAt: new Date(0),
    currentPhase: "completed",
    completionReason: "catalog_exhausted",
    targetAssets: 10_000,
    assetsPerItem: 10,
    totalCandidates: 1,
    lastCandidatesVisited: 1,
    publishedListingCount: 1,
    publishedFloatCount: 10,
    lastError: null,
    ...overrides,
  };
}

function interruptedRun() {
  const at = new Date("2026-07-21T12:00:00.000Z");
  return {
    id: "run-interrupted",
    stateKey: "youpin-assets-snapshot",
    status: "running",
    initialTriggeredBy: "scheduler",
    latestTriggeredBy: "scheduler",
    recoveryKind: "none",
    resumedFromRecovery: false,
    currentPhase: "building_priority_queue",
    runStartedAt: at,
    latestAttemptStartedAt: at,
    latestAttemptFinishedAt: null,
    runFinishedAt: null,
    lastHeartbeatAt: at,
    phaseStartedAt: at,
    metricsFlushedAt: at,
    attemptCount: 1,
    activeDurationMs: 1_000,
    pausedDurationMs: 0,
    quotaWaitDurationMs: 0,
    retryBackoffDurationMs: 0,
    pageRequests: 0,
    httpAttempts: 0,
    httpSucceeded: 0,
    httpFailed: 0,
    retryCount: 0,
    timeoutCount: 0,
    emptyResponseCount: 0,
    notFoundCount: 0,
    rateLimitedCount: 0,
    quotaWaitCount: 0,
    latencySampleCount: 0,
    latencyTotalMs: 0,
    latencyMaximumMs: 0,
    latencyLe250Count: 0,
    latencyLe1000Count: 0,
    latencyLe3000Count: 0,
    latencyLe10000Count: 0,
    latencyLe30000Count: 0,
    latencyGt30000Count: 0,
    runQuotaUnitsUsed: 0,
    creditsUsed: 0,
    configuredConcurrency: 3,
    currentConcurrency: 3,
    minimumConcurrencyUsed: 3,
    peakInFlight: 0,
    concurrencyReductionCount: 0,
    concurrencyIncreaseCount: 0,
    deferredCandidateCount: 0,
    throughputWindowStartedAt: at,
    throughputWindowStartValidAssets: 0,
    recentValidAssetsPerMinute: null,
    targetAssets: 10_000,
    assetsPerItem: 10,
    totalCandidates: 0,
    candidatesVisited: 0,
    rawAssetCount: 0,
    validAssetCount: 0,
    skippedAssetCount: 0,
    publishedListingCount: 0,
    publishedFloatCount: 0,
    snapshotHash: null,
    completionReason: null,
    lastError: null,
    phases: [],
  };
}

describe("GetMarketSyncStatusUseCase (assets-only)", () => {
  it("informa sólo progreso de assets y no acopla el catálogo de precios", async () => {
    const useCase = new GetMarketSyncStatusUseCase(
      store() as any,
      { get: vi.fn(async () => publishedState()) } as any,
    );

    const status = await useCase.execute();

    expect(status).toMatchObject({
      running: false,
      phase: "completed",
      validAssets: 10,
      publishedFloats: 10,
      itemsCatalog: null,
    });
  });

  it("normaliza como éxito de assets un estado legacy syncing_bots", async () => {
    const useCase = new GetMarketSyncStatusUseCase(
      store() as any,
      {
        get: vi.fn(async () =>
          publishedState({
            currentPhase: "syncing_bots",
            lastSuccessfulAt: null,
            lastError: "bot inventory failed",
          }),
        ),
      } as any,
    );

    const status = await useCase.execute();

    expect(status.phase).toBe("completed");
    expect(status.lastError).toBeNull();
    expect(status.lastSuccessfulAt).toBe(new Date(0).toISOString());
  });

  it("no expone como auto-recuperable el checkpoint de una corrida fatal", async () => {
    const checkpointStore = store();
    checkpointStore.getCheckpointStatus.mockResolvedValue({
      exists: true,
      targetAssets: 10_000,
      validAssetCount: 100,
      rawAssetCount: 100,
      skippedAssetCount: 0,
      candidatesVisited: 20,
      totalCandidates: 1_000,
      creditsUsed: 0,
    });
    const useCase = new GetMarketSyncStatusUseCase(
      checkpointStore as any,
      {
        get: vi.fn(async () =>
          publishedState({
            currentPhase: "failed",
            lastError: "SteamWebAPI respondió 401",
          }),
        ),
      } as any,
    );

    const status = await useCase.execute();

    expect(status.phase).toBe("failed");
    expect(status.resumable).toBe(false);
  });

  it("expone como recuperable una publicación pendiente sólo de finalización", async () => {
    const useCase = new GetMarketSyncStatusUseCase(
      store() as any,
      {
        get: vi.fn(async () =>
          publishedState({
            currentPhase: "failed",
            lastError: "run transaction failed",
            lastPublishedAt: new Date("2026-07-21T12:00:01.000Z"),
            lastSuccessfulAt: new Date("2026-07-21T12:00:00.000Z"),
          }),
        ),
      } as any,
    );

    const status = await useCase.execute();

    expect(status.phase).toBe("paused");
    expect(status.resumable).toBe(true);
    expect(status.message).toContain("recuperable");
  });

  it("reconcilia como pausa una corrida durable interrumpida antes del checkpoint", async () => {
    const useCase = new GetMarketSyncStatusUseCase(
      store() as any,
      {
        get: vi.fn(async () =>
          publishedState({
            currentPhase: "building_priority_queue",
            activeRunId: "run-interrupted",
          }),
        ),
      } as any,
      {
        getCurrentOrLast: vi.fn(async () => interruptedRun()),
      } as any,
    );

    const status = await useCase.execute();

    expect(status.phase).toBe("paused");
    expect(status.resumable).toBe(true);
    expect(status.run).toMatchObject({
      id: "run-interrupted",
      status: "paused",
      slowReason: "paused",
    });
  });

  it("expone una cancelación durable como terminal sin descartar el checkpoint", async () => {
    const checkpointStore = store();
    checkpointStore.getCheckpointStatus.mockResolvedValue({
      exists: true,
      targetAssets: 10_000,
      validAssetCount: 3_797,
      rawAssetCount: 3_800,
      skippedAssetCount: 3,
      candidatesVisited: 2_189,
      totalCandidates: 16_566,
      creditsUsed: 0,
    } as any);
    const cancelledAt = new Date("2026-07-21T12:08:00.000Z");
    const useCase = new GetMarketSyncStatusUseCase(
      checkpointStore as any,
      {
        get: vi.fn(async () =>
          publishedState({
            currentPhase: "cancelled",
            lastFinishedAt: cancelledAt,
            lastError: null,
          }),
        ),
      } as any,
      {
        getCurrentOrLast: vi.fn(async () => ({
          ...interruptedRun(),
          status: "cancelled",
          currentPhase: "cancelled",
          latestAttemptFinishedAt: cancelledAt,
          runFinishedAt: cancelledAt,
          lastError: "Sincronización cancelada por un administrador.",
        })),
      } as any,
    );

    const status = await useCase.execute();

    expect(status).toMatchObject({
      running: false,
      resumable: false,
      phase: "cancelled",
      validAssets: 3_797,
      lastError: null,
    });
    expect(status.run?.status).toBe("cancelled");
    expect(status.message).toContain("progreso quedó guardado");
  });

  it("recupera workers, breaker y SLO desde el checkpoint v4", async () => {
    const checkpointStore = store();
    checkpointStore.getCheckpointStatus.mockResolvedValue({
      exists: true,
      targetAssets: 10_000,
      validAssetCount: 1_000,
      rawAssetCount: 1_000,
      skippedAssetCount: 0,
      candidatesVisited: 200,
      totalCandidates: 2_000,
      creditsUsed: 0,
      concurrency: 48,
      initialConcurrency: 6,
      effectiveConcurrency: 21,
      circuitBreaker: {
        state: "open",
        openCount: 2,
        resumeAt: "2026-07-21T12:08:45.000Z",
      },
      targetDurationSeconds: 600,
      targetDeadlineAt: "2026-07-21T12:10:00.000Z",
      tenMinuteTargetUnreachable: true,
    } as any);
    const useCase = new GetMarketSyncStatusUseCase(
      checkpointStore as any,
      {
        get: vi.fn(async () =>
          publishedState({
            currentPhase: "paused",
            targetAssets: 10_000,
          }),
        ),
      } as any,
      {
        getCurrentOrLast: vi.fn(async () => ({
          ...interruptedRun(),
          status: "paused",
          currentPhase: "paused",
          configuredConcurrency: 48,
          currentConcurrency: 21,
          totalCandidates: 2_000,
          candidatesVisited: 200,
          validAssetCount: 1_000,
          latestAttemptFinishedAt: new Date("2026-07-21T12:08:00.000Z"),
        })),
      } as any,
    );

    const status = await useCase.execute();

    expect(status.run?.workers).toMatchObject({
      initial: 6,
      max: 48,
      effective: 21,
      inFlight: 0,
      queueDepth: 1_800,
    });
    expect(status.run?.circuitBreaker).toEqual({
      state: "open",
      openCount: 2,
      resumeAt: "2026-07-21T12:08:45.000Z",
    });
    expect(status.run?.throughput.targetDurationSeconds).toBe(600);
    expect(status.run?.warnings).toContain("ten_minute_target_unreachable");
  });
});
