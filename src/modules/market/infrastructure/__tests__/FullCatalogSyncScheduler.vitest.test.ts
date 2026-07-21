import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../MarketSyncDependencies", () => ({
  getMarketSyncStatusUseCase: { execute: vi.fn() },
  runFullCatalogSyncUseCase: { execute: vi.fn() },
}));

import { MarketAssetsApiError } from "../../application/IMarketAssetsCatalogClient";
import { MarketAssetsPriorityQueueError } from "../../application/MarketAssetsPriorityQueue";
import { SyncExecutionBusyError } from "../../application/RunFullCatalogSyncUseCase";
import {
  createFullCatalogSyncScheduler,
  type FullCatalogSyncSchedulerResult,
  type FullCatalogSyncSchedulerStatus,
} from "../FullCatalogSyncScheduler";
import { createLocalPriceCatalogSyncScheduler } from "../../../pricing/infrastructure/LocalPriceCatalogSyncScheduler";

const INTERVAL_MINUTES = 300;
const INTERVAL_MS = INTERVAL_MINUTES * 60_000;
const STARTED_AT = new Date("2026-07-20T12:00:00.000Z");

const result: FullCatalogSyncSchedulerResult = {
  snapshotHash: "a".repeat(64),
  validAssets: 10_000,
  listings: 1_000,
};

function publishedStatus(at: number): FullCatalogSyncSchedulerStatus {
  return {
    resumable: false,
    snapshotHash: result.snapshotHash,
    lastSuccessfulAt: new Date(at).toISOString(),
    quotaResetsAt: null,
  };
}

function createHarness(options?: {
  status?: FullCatalogSyncSchedulerStatus;
  execute?: () => Promise<FullCatalogSyncSchedulerResult>;
}) {
  let status: FullCatalogSyncSchedulerStatus = options?.status ?? {
    resumable: false,
    snapshotHash: null,
    lastSuccessfulAt: null,
    quotaResetsAt: null,
  };
  const getStatus = vi.fn(async () => status);
  const execute = vi.fn(
    options?.execute ??
      (async () => {
        status = publishedStatus(Date.now());
        return result;
      }),
  );
  const scheduler = createFullCatalogSyncScheduler({
    enabled: true,
    intervalMinutes: INTERVAL_MINUTES,
    getStatus,
    execute,
    logger: { log: vi.fn(), error: vi.fn() },
  });

  return {
    scheduler,
    getStatus,
    execute,
    setStatus(next: FullCatalogSyncSchedulerStatus) {
      status = next;
    },
  };
}

describe("FullCatalogSyncScheduler (assets-only)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ejecuta al iniciar cuando no existe una publicación durable", async () => {
    const harness = createHarness();
    harness.scheduler.start();

    await vi.advanceTimersByTimeAsync(999);
    expect(harness.execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledOnce();
    expect(harness.getStatus).toHaveBeenCalledTimes(3);
    harness.scheduler.stop();
  });

  it("agenda el ciclo siguiente 300 minutos después del último éxito", async () => {
    const harness = createHarness();
    harness.scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledTimes(2);
    harness.scheduler.stop();
  });

  it("recalcula el vencimiento si una ejecución manual actualizó el último éxito", async () => {
    const initialSuccess = STARTED_AT.getTime();
    const harness = createHarness({ status: publishedStatus(initialSuccess) });
    harness.scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(100 * 60_000);
    harness.setStatus(publishedStatus(Date.now()));

    // Llega el timer originalmente armado para t+300m, pero el nuevo éxito
    // manual lo desplaza hasta t+400m.
    await vi.advanceTimersByTimeAsync(200 * 60_000);
    expect(harness.execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100 * 60_000 - 1);
    expect(harness.execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledOnce();
    harness.scheduler.stop();
  });

  it("reintenta en 60 segundos cuando un proceso bot-only posee el lock", async () => {
    let attempt = 0;
    let harness!: ReturnType<typeof createHarness>;
    harness = createHarness({
      execute: async () => {
        attempt += 1;
        if (attempt === 1) throw new SyncExecutionBusyError("bot_only");
        harness.setStatus(publishedStatus(Date.now()));
        return result;
      },
    });
    harness.scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledTimes(2);
    harness.scheduler.stop();
  });

  it("reintenta pronto si el catálogo local aún se está creando en un startup limpio", async () => {
    let attempt = 0;
    let harness!: ReturnType<typeof createHarness>;
    harness = createHarness({
      execute: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new MarketAssetsPriorityQueueError(
            "catalog_missing",
            "items-catalog.json todavía no existe",
          );
        }
        harness.setStatus(publishedStatus(Date.now()));
        return result;
      },
    });
    harness.scheduler.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledTimes(2);
    harness.scheduler.stop();
  });

  it("reanuda assets cuando el scheduler de catálogo termina el startup limpio", async () => {
    let finishCatalog!: () => void;
    const catalogGate = new Promise<void>((resolve) => {
      finishCatalog = resolve;
    });
    let catalogStatus = {
      exists: false,
      fetchedAt: null as string | null,
      running: false,
    };
    const catalogExecute = vi.fn(async () => {
      catalogStatus = { ...catalogStatus, running: true };
      await catalogGate;
      catalogStatus = {
        exists: true,
        fetchedAt: new Date(Date.now()).toISOString(),
        running: false,
      };
      return { itemCount: 25_000, fetchedAt: catalogStatus.fetchedAt };
    });
    const catalogScheduler = createLocalPriceCatalogSyncScheduler({
      enabled: true,
      intervalMinutes: INTERVAL_MINUTES,
      getStatus: async () => catalogStatus,
      execute: catalogExecute,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    let assets!: ReturnType<typeof createHarness>;
    assets = createHarness({
      execute: async () => {
        if (!catalogStatus.exists) {
          throw new MarketAssetsPriorityQueueError(
            "catalog_missing",
            "items-catalog.json todavía no existe",
          );
        }
        assets.setStatus(publishedStatus(Date.now()));
        return result;
      },
    });

    catalogScheduler.start();
    assets.scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(catalogExecute).toHaveBeenCalledOnce();
    expect(assets.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(59_999);
    finishCatalog();
    await vi.advanceTimersByTimeAsync(0);
    expect(catalogStatus.exists).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(assets.execute).toHaveBeenCalledTimes(2);
    catalogScheduler.stop();
    assets.scheduler.stop();
  });

  it("reanuda un checkpoint tras un 429 en quotaResetsAt más un segundo de margen", async () => {
    let attempt = 0;
    let harness!: ReturnType<typeof createHarness>;
    harness = createHarness({
      execute: async () => {
        attempt += 1;
        if (attempt === 1) {
          harness.setStatus({
            resumable: true,
            snapshotHash: null,
            lastSuccessfulAt: null,
            quotaResetsAt: new Date(Date.now() + 30_000).toISOString(),
          });
          throw new MarketAssetsApiError(
            "SteamWebAPI respondió 429",
            "retryable",
            429,
            10,
          );
        }
        harness.setStatus(publishedStatus(Date.now()));
        return result;
      },
    });
    harness.scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30_999);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledTimes(2);
    harness.scheduler.stop();
  });

  it.each([0, 408, 500])(
    "conserva el checkpoint tras HTTP %i agotado sin reintentar cada minuto",
    async (statusCode) => {
      let harness!: ReturnType<typeof createHarness>;
      harness = createHarness({
        execute: async () => {
          harness.setStatus({
            resumable: true,
            snapshotHash: null,
            lastSuccessfulAt: null,
            quotaResetsAt: new Date(Date.now() + 30_000).toISOString(),
          });
          throw new MarketAssetsApiError(
            `SteamWebAPI falló con HTTP ${statusCode}`,
            "retryable",
            statusCode,
            10,
          );
        },
      });
      harness.scheduler.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(harness.execute).toHaveBeenCalledOnce();

      // El reset próximo no aplica: el cliente HTTP ya agotó sus intentos.
      await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
      expect(harness.execute).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(harness.execute).toHaveBeenCalledTimes(2);
      harness.scheduler.stop();
    },
  );

  it("conserva un checkpoint fatal sin reintentar hasta el ciclo normal", async () => {
    let harness!: ReturnType<typeof createHarness>;
    harness = createHarness({
      execute: async () => {
        harness.setStatus({
          resumable: true,
          snapshotHash: null,
          lastSuccessfulAt: null,
          // Aunque el reset esté próximo, un 401 fatal no es recuperable por
          // esperar esa ventana.
          quotaResetsAt: new Date(Date.now() + 30_000).toISOString(),
        });
        throw new MarketAssetsApiError(
          "SteamWebAPI respondió 401",
          "fatal",
          401,
          10,
        );
      },
    });
    harness.scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(harness.execute).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledTimes(2);
    harness.scheduler.stop();
  });

  it("tras reiniciar agenda un fallo fatal desde el fin del intento", async () => {
    const failedAt = STARTED_AT.getTime() - 60_000;
    const harness = createHarness({
      status: {
        resumable: false,
        snapshotHash: null,
        lastSuccessfulAt: new Date(STARTED_AT.getTime() - INTERVAL_MS).toISOString(),
        lastFinishedAt: new Date(failedAt).toISOString(),
        phase: "failed",
        quotaResetsAt: null,
      },
    });

    harness.scheduler.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 60_001);
    expect(harness.execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledOnce();
    harness.scheduler.stop();
  });
});
