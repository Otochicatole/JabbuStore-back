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
});
