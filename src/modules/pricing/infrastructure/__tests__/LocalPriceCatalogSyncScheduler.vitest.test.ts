import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../application/ItemsCatalogRefreshService", () => ({
  itemsCatalogRefreshService: {
    getStatus: vi.fn(),
    refreshNow: vi.fn(),
  },
}));

import {
  createLocalPriceCatalogSyncScheduler,
  type LocalPriceCatalogSchedulerResult,
  type LocalPriceCatalogSchedulerStatus,
} from "../LocalPriceCatalogSyncScheduler";

const INTERVAL_MINUTES = 720;
const INTERVAL_MS = INTERVAL_MINUTES * 60_000;
const STARTED_AT = new Date("2026-07-20T12:00:00.000Z");

const result: LocalPriceCatalogSchedulerResult = {
  itemCount: 25_000,
  fetchedAt: STARTED_AT.toISOString(),
};

function freshStatus(at: number): LocalPriceCatalogSchedulerStatus {
  return {
    exists: true,
    fetchedAt: new Date(at).toISOString(),
    running: false,
  };
}

function createHarness(options?: {
  enabled?: boolean;
  status?: LocalPriceCatalogSchedulerStatus;
  execute?: () => Promise<LocalPriceCatalogSchedulerResult>;
}) {
  let status: LocalPriceCatalogSchedulerStatus = options?.status ?? {
    exists: false,
    fetchedAt: null,
    running: false,
  };
  const getStatus = vi.fn(async () => status);
  const execute = vi.fn(
    options?.execute ??
      (async () => {
        status = freshStatus(Date.now());
        return { ...result, fetchedAt: status.fetchedAt };
      }),
  );
  const scheduler = createLocalPriceCatalogSyncScheduler({
    enabled: options?.enabled ?? true,
    intervalMinutes: INTERVAL_MINUTES,
    getStatus,
    execute,
    logger: { log: vi.fn(), error: vi.fn() },
  });

  return {
    scheduler,
    getStatus,
    execute,
    setStatus(next: LocalPriceCatalogSchedulerStatus) {
      status = next;
    },
  };
}

describe("LocalPriceCatalogSyncScheduler (catalog-only)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("descarga al iniciar cuando todavía no existe items-catalog.json", async () => {
    const harness = createHarness();
    harness.scheduler.start();

    await vi.advanceTimersByTimeAsync(999);
    expect(harness.execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledOnce();
    harness.scheduler.stop();
  });

  it("usa fetchedAt para esperar 720 minutos entre descargas", async () => {
    const harness = createHarness({
      status: freshStatus(STARTED_AT.getTime()),
    });
    harness.scheduler.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(harness.execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledOnce();
    harness.scheduler.stop();
  });

  it("recalcula el vencimiento si el endpoint manual refrescó el archivo", async () => {
    const harness = createHarness({
      status: freshStatus(STARTED_AT.getTime()),
    });
    harness.scheduler.start();
    await vi.advanceTimersByTimeAsync(100 * 60_000);
    harness.setStatus(freshStatus(Date.now()));

    await vi.advanceTimersByTimeAsync(620 * 60_000);
    expect(harness.execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100 * 60_000 - 1);
    expect(harness.execute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledOnce();
    harness.scheduler.stop();
  });

  it("no se suma a un refresh manual activo y vuelve a comprobar en 60 segundos", async () => {
    const harness = createHarness({
      status: { exists: false, fetchedAt: null, running: true },
    });
    harness.scheduler.start();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(harness.execute).not.toHaveBeenCalled();
    harness.setStatus({ exists: false, fetchedAt: null, running: false });

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.execute).toHaveBeenCalledOnce();
    harness.scheduler.stop();
  });

  it("conserva el catálogo anterior y espera el ciclo normal después de un error", async () => {
    const harness = createHarness({
      execute: async () => {
        throw new Error("Items API parcial");
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

  it("se habilita sólo con su flag, sin depender del scheduler de assets", async () => {
    const harness = createHarness({ enabled: false });
    harness.scheduler.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(harness.getStatus).not.toHaveBeenCalled();
    expect(harness.execute).not.toHaveBeenCalled();
    harness.scheduler.stop();
  });
});
