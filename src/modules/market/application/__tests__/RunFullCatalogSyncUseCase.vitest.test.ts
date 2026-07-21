import { describe, expect, it, vi } from "vitest";
import { RunFullCatalogSyncUseCase } from "../RunFullCatalogSyncUseCase";
import { syncExecutionCoordinator } from "../SyncExecutionCoordinator";

function marketResult() {
  return {
    listings: 2,
    floats: 20,
    rawAssets: 24,
    validAssets: 20,
    skippedAssets: 4,
    snapshotHash: "a".repeat(64),
    fetchedAt: new Date(0).toISOString(),
    completionReason: "catalog_exhausted" as const,
    recoveredSnapshot: false,
  };
}

function stateRepository() {
  return {
    markStarted: vi.fn(async () => undefined),
    markFullSuccess: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  };
}

describe("RunFullCatalogSyncUseCase (assets-only)", () => {
  it("ejecuta únicamente assets y comparte una sola promesa", async () => {
    let releaseAssets!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseAssets = resolve;
    });
    const refreshMarket = {
      recoverPending: vi.fn(async () => null),
      execute: vi.fn(async () => {
        await gate;
        return marketResult();
      }),
    };
    const state = stateRepository();
    const useCase = new RunFullCatalogSyncUseCase(
      refreshMarket as any,
      state as any,
    );

    const first = useCase.tryStart("manual");
    const second = useCase.tryStart("scheduler");
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.execution).toBe(first.execution);

    releaseAssets();
    const result = await first.execution;
    expect(result).toEqual(marketResult());
    expect(refreshMarket.execute).toHaveBeenCalledOnce();
    expect(state.markStarted).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      0,
      expect.objectContaining({ phase: "building_priority_queue" }),
    );
    expect(state.markFullSuccess).toHaveBeenCalledOnce();
  });

  it("finaliza una publicación durable pendiente sin recolectar otra vez", async () => {
    const recovered = { ...marketResult(), recoveredSnapshot: true };
    const refreshMarket = {
      recoverPending: vi.fn(async () => recovered),
      execute: vi.fn(),
    };
    const state = stateRepository();
    const useCase = new RunFullCatalogSyncUseCase(
      refreshMarket as any,
      state as any,
    );

    const result = await useCase.execute("scheduler-startup");

    expect(result.recoveredSnapshot).toBe(true);
    expect(refreshMarket.execute).not.toHaveBeenCalled();
    expect(state.markStarted).not.toHaveBeenCalled();
    expect(state.markFullSuccess).toHaveBeenCalledOnce();
  });

  it("marca failed si falla la recolección/publicación", async () => {
    const refreshMarket = {
      recoverPending: vi.fn(async () => null),
      execute: vi.fn(async () => {
        throw new Error("asset failure");
      }),
    };
    const state = stateRepository();
    const useCase = new RunFullCatalogSyncUseCase(
      refreshMarket as any,
      state as any,
    );

    await expect(useCase.execute("manual")).rejects.toThrow("asset failure");
    expect(state.markFullSuccess).not.toHaveBeenCalled();
    expect(state.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      "asset failure",
    );
  });

  it("no inicia assets mientras el job bot-only posee el lock", async () => {
    const botLease = syncExecutionCoordinator.tryAcquire("bot_only");
    expect(botLease).not.toBeNull();
    const useCase = new RunFullCatalogSyncUseCase(
      {
        recoverPending: vi.fn(async () => marketResult()),
        execute: vi.fn(),
      } as any,
      stateRepository() as any,
    );
    try {
      const started = useCase.tryStart("manual");
      expect(started).toEqual({
        started: false,
        execution: null,
        blockingReason: "bot_only",
      });
    } finally {
      botLease?.release();
    }
  });
});
