import { describe, expect, it, vi } from "vitest";
import { RunFullCatalogSyncUseCase } from "../RunFullCatalogSyncUseCase";
import { syncExecutionCoordinator } from "../SyncExecutionCoordinator";
import type { SyncYoupinCatalogResult } from "../SyncYoupinCatalogUseCase";

function marketResult(): SyncYoupinCatalogResult {
  return {
    matched: 10,
    skippedNoPrice: 2,
    skippedNotInCatalog: 1,
    totalCatalogItems: 11,
    totalPriceRows: 13,
    durationMs: 1500,
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
    
    const syncCatalog = {
      execute: vi.fn(async () => {
        await gate;
        return marketResult();
      }),
    };
    
    const state = stateRepository();
    const useCase = new RunFullCatalogSyncUseCase(
      syncCatalog as any,
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
    expect(syncCatalog.execute).toHaveBeenCalledOnce();
    expect(state.markFullSuccess).toHaveBeenCalledOnce();
  });

  it("marca failed si falla la recolección/publicación", async () => {
    const syncCatalog = {
      execute: vi.fn(async () => {
        throw new Error("asset failure");
      }),
    };
    const state = stateRepository();
    const useCase = new RunFullCatalogSyncUseCase(
      syncCatalog as any,
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
      { execute: vi.fn() } as any,
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
