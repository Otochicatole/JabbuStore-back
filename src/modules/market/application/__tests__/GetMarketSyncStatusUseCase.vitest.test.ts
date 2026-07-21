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
});
