import { describe, expect, it, vi } from "vitest";
import { RunFullCatalogSyncUseCase } from "../RunFullCatalogSyncUseCase";
import { syncExecutionCoordinator } from "../SyncExecutionCoordinator";
import { MarketAssetsApiError } from "../IMarketAssetsCatalogClient";
import { config } from "../../../../shared/config";

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

  it("reanuda la misma corrida durable con un intento nuevo", async () => {
    const recovered = { ...marketResult(), recoveredSnapshot: true };
    const refreshMarket = {
      hasPendingRecovery: vi.fn(async () => true),
      recoverPending: vi.fn(async () => recovered),
      execute: vi.fn(),
    };
    const state = stateRepository();
    const runs = {
      startAttempt: vi.fn(async () => ({ id: "run-1" })),
      heartbeat: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
      finishAttempt: vi.fn(async () => undefined),
    };
    const useCase = new RunFullCatalogSyncUseCase(
      refreshMarket as any,
      state as any,
      runs as any,
    );

    await expect(useCase.execute("scheduler-startup")).resolves.toEqual(
      recovered,
    );

    expect(runs.startAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        stateKey: expect.any(String),
        triggeredBy: "scheduler-startup",
        recoveryRequested: true,
        recoveryKind: "pending",
      }),
    );
    expect(state.markStarted).not.toHaveBeenCalled();
    expect(runs.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ completionReason: "catalog_exhausted" }),
    );
    expect(runs.finishAttempt).not.toHaveBeenCalled();
    expect(runs.complete.mock.invocationCallOrder[0]).toBeLessThan(
      state.markFullSuccess.mock.invocationCallOrder[0]!,
    );
  });

  it("registra el máximo configurado como concurrencia inicial en modo forzado", async () => {
    const previousForce = config.marketAssetsCatalog.forceMaxConcurrency;
    const previousMaximum = config.marketAssetsCatalog.concurrency;
    const previousInitial = config.marketAssetsCatalog.initialConcurrency;
    config.marketAssetsCatalog.forceMaxConcurrency = true;
    config.marketAssetsCatalog.concurrency = 48;
    config.marketAssetsCatalog.initialConcurrency = 6;

    const refreshMarket = {
      hasPendingRecovery: vi.fn(async () => false),
      recoverPending: vi.fn(async () => marketResult()),
      execute: vi.fn(),
    };
    const runs = {
      startAttempt: vi.fn(async () => ({ id: "run-forced" })),
      heartbeat: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
      finishAttempt: vi.fn(async () => undefined),
    };

    try {
      const useCase = new RunFullCatalogSyncUseCase(
        refreshMarket as any,
        stateRepository() as any,
        runs as any,
      );

      await expect(useCase.execute("manual")).resolves.toEqual(marketResult());
      expect(runs.startAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          configuredConcurrency: 48,
          initialConcurrency: 48,
        }),
      );
    } finally {
      config.marketAssetsCatalog.forceMaxConcurrency = previousForce;
      config.marketAssetsCatalog.concurrency = previousMaximum;
      config.marketAssetsCatalog.initialConcurrency = previousInitial;
    }
  });

  it("conserva recuperable la publicación si falla el cierre durable de la corrida", async () => {
    const refreshMarket = {
      hasPendingRecovery: vi.fn(async () => true),
      recoverPending: vi.fn(async () => marketResult()),
      execute: vi.fn(),
    };
    const state = stateRepository();
    const runs = {
      startAttempt: vi.fn(async () => ({ id: "run-1" })),
      heartbeat: vi.fn(async () => undefined),
      complete: vi.fn(async () => {
        throw new Error("run transaction failed");
      }),
      finishAttempt: vi.fn(async () => undefined),
    };
    const useCase = new RunFullCatalogSyncUseCase(
      refreshMarket as any,
      state as any,
      runs as any,
    );

    await expect(useCase.execute("scheduler-startup")).rejects.toThrow(
      "run transaction failed",
    );

    expect(state.markFullSuccess).not.toHaveBeenCalled();
    expect(state.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      "run transaction failed",
      true,
    );
    expect(runs.finishAttempt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ resumable: true }),
    );
  });

  it("abre una corrida nueva cuando el checkpoint existe pero es incompatible", async () => {
    const recovered = marketResult();
    const refreshMarket = {
      hasPendingRecovery: vi.fn(async () => false),
      // `recoverPending` deja que Collector elimine el checkpoint incompatible
      // y ejecute desde cero dentro de la corrida recién abierta.
      recoverPending: vi.fn(async () => recovered),
      execute: vi.fn(),
    };
    const runs = {
      startAttempt: vi.fn(async () => ({ id: "run-new" })),
      heartbeat: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
      finishAttempt: vi.fn(async () => undefined),
    };
    const useCase = new RunFullCatalogSyncUseCase(
      refreshMarket as any,
      stateRepository() as any,
      runs as any,
    );

    await expect(useCase.execute("scheduler")).resolves.toEqual(recovered);
    expect(runs.startAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryRequested: false,
        recoveryKind: "none",
      }),
    );
  });

  it("no abre ni reemplaza una corrida si no puede evaluar readiness", async () => {
    const readiness = new Error("catálogo local ausente");
    const refreshMarket = {
      hasPendingRecovery: vi.fn(async () => {
        throw readiness;
      }),
      recoverPending: vi.fn(),
      execute: vi.fn(),
    };
    const runs = {
      startAttempt: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      finishAttempt: vi.fn(),
    };
    const useCase = new RunFullCatalogSyncUseCase(
      refreshMarket as any,
      stateRepository() as any,
      runs as any,
    );

    await expect(useCase.execute("scheduler")).rejects.toBe(readiness);
    expect(runs.startAttempt).not.toHaveBeenCalled();
    expect(refreshMarket.recoverPending).not.toHaveBeenCalled();
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

  it("no marca auto-recuperable un checkpoint cuando SteamWebAPI falla de forma fatal", async () => {
    const fatal = new MarketAssetsApiError(
      "SteamWebAPI respondió 401",
      "fatal",
      401,
      10,
    );
    const refreshMarket = {
      hasPendingRecovery: vi.fn(async () => true),
      recoverPending: vi.fn(async () => null),
      execute: vi.fn(async () => {
        throw fatal;
      }),
    };
    const state = stateRepository();
    const runs = {
      startAttempt: vi.fn(async () => ({ id: "run-fatal" })),
      heartbeat: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
      finishAttempt: vi.fn(async () => undefined),
    };
    const useCase = new RunFullCatalogSyncUseCase(
      refreshMarket as any,
      state as any,
      runs as any,
    );

    await expect(useCase.execute("scheduler")).rejects.toBe(fatal);

    expect(state.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      fatal.message,
    );
    expect(runs.finishAttempt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ resumable: false }),
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
