import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MarketAssetRequestPacer,
  MarketAssetRequestPacerCancelledError,
  type MarketAssetRequestPacerOutcome,
} from "../MarketAssetRequestPacer";

const START = Date.parse("2026-07-23T22:00:00.000Z");

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function observe(
  pacer: MarketAssetRequestPacer,
  outcome: MarketAssetRequestPacerOutcome,
  count: number,
  validAssets = outcome === "success" ? 5 : 0,
): void {
  for (let index = 0; index < count; index++) {
    pacer.observe({
      outcome,
      validAssets,
      completedAt: Date.now(),
    });
  }
}

describe("MarketAssetRequestPacer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("conserva 48 workers lógicos en cola sin iniciar un burst mayor a cuatro", async () => {
    const pacer = new MarketAssetRequestPacer();
    const startedAt: number[] = [];
    const acquisitions = Array.from({ length: 48 }, () =>
      pacer.acquire().then(() => startedAt.push(Date.now())),
    );

    await flushPromises();
    expect(startedAt).toHaveLength(4);
    expect(pacer.getSnapshot()).toMatchObject({
      currentStartsPerSecond: 4,
      burstLimit: 4,
      acquired: 4,
      queued: 44,
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(startedAt).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(startedAt).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(10_750);
    await Promise.all(acquisitions);
    expect(startedAt).toHaveLength(48);
    expect(
      Math.max(
        ...Array.from(
          new Set(startedAt),
          (timestamp) =>
            startedAt.filter((value) => value === timestamp).length,
        ),
      ),
    ).toBeLessThanOrEqual(4);
  });

  it("cancela un worker en espera mediante AbortSignal sin afectar la cola", async () => {
    const pacer = new MarketAssetRequestPacer();
    await Promise.all(Array.from({ length: 4 }, () => pacer.acquire()));
    const controller = new AbortController();
    const cancelled = pacer.acquire(controller.signal);
    const survivor = pacer.acquire();

    expect(pacer.getSnapshot().queued).toBe(2);
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(
      MarketAssetRequestPacerCancelledError,
    );
    expect(pacer.getSnapshot().queued).toBe(1);

    await vi.advanceTimersByTimeAsync(250);
    await survivor;
    expect(pacer.getSnapshot()).toMatchObject({
      acquired: 5,
      queued: 0,
    });
  });

  it("rechaza inmediatamente una señal que ya estaba cancelada", async () => {
    const pacer = new MarketAssetRequestPacer();
    const controller = new AbortController();
    controller.abort();

    await expect(pacer.acquire(controller.signal)).rejects.toBeInstanceOf(
      MarketAssetRequestPacerCancelledError,
    );
    expect(pacer.getSnapshot().queued).toBe(0);
  });

  it("reduce 25% cuando la congestión de una ventana supera 10%", () => {
    const pacer = new MarketAssetRequestPacer();
    observe(pacer, "server_error", 6);
    observe(pacer, "success", 42);

    expect(pacer.getSnapshot()).toMatchObject({
      currentStartsPerSecond: 3,
      healthyWindowStreak: 0,
      window: { observations: 0 },
      gate: { state: "closed" },
    });
  });

  it("no reduce por una tasa de congestión menor o igual a 10%", () => {
    const pacer = new MarketAssetRequestPacer();
    observe(pacer, "timeout", 4);
    observe(pacer, "success", 44);

    expect(pacer.getSnapshot()).toMatchObject({
      currentStartsPerSecond: 4,
      healthyWindowStreak: 0,
      gate: { state: "closed" },
    });
  });

  it("abre gate tras ocho fallos consecutivos y reduce el ritmo a la mitad", async () => {
    const pacer = new MarketAssetRequestPacer();
    observe(pacer, "server_error", 8);
    const snapshot = pacer.getSnapshot();

    expect(snapshot).toMatchObject({
      currentStartsPerSecond: 2,
      consecutiveCongestionFailures: 0,
      gate: {
        state: "open",
        reason: "congestion",
        resumeAt: START + 2_000,
        openCount: 1,
      },
    });

    const waiting = pacer.acquire();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(pacer.getSnapshot().acquired).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(pacer.getSnapshot().gate.state).toBe("closed");
  });

  it("abre gate con 50% de congestión aunque los fallos no sean consecutivos", () => {
    const pacer = new MarketAssetRequestPacer();
    for (let index = 0; index < 24; index++) {
      observe(pacer, "timeout", 1);
      observe(pacer, "success", 1);
    }

    expect(pacer.getSnapshot()).toMatchObject({
      currentStartsPerSecond: 2,
      gate: {
        state: "open",
        reason: "congestion",
        resumeAt: START + 2_000,
        openCount: 1,
      },
    });
  });

  it("escala el backoff de congestión entre dos y diez segundos", async () => {
    const pacer = new MarketAssetRequestPacer({
      initialStartsPerSecond: 8,
    });
    observe(pacer, "network_error", 8);
    expect(pacer.getSnapshot().gate.resumeAt).toBe(START + 2_000);

    await vi.advanceTimersByTimeAsync(2_000);
    observe(pacer, "server_error", 8);
    expect(pacer.getSnapshot()).toMatchObject({
      currentStartsPerSecond: 2,
      gate: {
        resumeAt: START + 6_000,
        openCount: 2,
      },
    });

    await vi.advanceTimersByTimeAsync(4_000);
    observe(pacer, "timeout", 8);
    expect(pacer.getSnapshot().gate.resumeAt).toBe(START + 14_000);

    await vi.advanceTimersByTimeAsync(8_000);
    observe(pacer, "timeout", 8);
    expect(pacer.getSnapshot().gate.resumeAt).toBe(START + 24_000);
  });

  it("aumenta 25% después de dos ventanas saludables completas", () => {
    const pacer = new MarketAssetRequestPacer();
    observe(pacer, "success", 48);
    expect(pacer.getSnapshot()).toMatchObject({
      currentStartsPerSecond: 4,
      healthyWindowStreak: 1,
    });

    observe(pacer, "success", 48);
    expect(pacer.getSnapshot()).toMatchObject({
      currentStartsPerSecond: 5,
      healthyWindowStreak: 0,
      observations: 96,
      validAssets: 480,
    });
  });

  it("nunca supera el máximo configurado al aumentar", () => {
    const pacer = new MarketAssetRequestPacer({
      initialStartsPerSecond: 16,
      maxStartsPerSecond: 16,
    });
    observe(pacer, "success", 96);

    expect(pacer.getSnapshot().currentStartsPerSecond).toBe(16);
  });

  it("a 16 req/s deja margen bajo la cuota de 10.000 assets por minuto", async () => {
    const pacer = new MarketAssetRequestPacer({
      initialStartsPerSecond: 16,
      maxStartsPerSecond: 16,
    });
    const acquisitions = Array.from({ length: 1_100 }, () =>
      pacer.acquire(),
    );

    await vi.advanceTimersByTimeAsync(60_000);

    // Cuatro permisos iniciales + 16 por segundo. Aun suponiendo limit=10,
    // son 9.640 unidades, por debajo de las 10.000 del proveedor.
    expect(pacer.getSnapshot().acquired).toBe(964);
    expect(pacer.getSnapshot().acquired * 10).toBeLessThan(10_000);

    // Evita dejar promesas/timers pendientes al terminar el test.
    pacer.reset();
    await vi.advanceTimersByTimeAsync(8_500);
    await Promise.all(acquisitions);
  });

  it("un 429 bloquea toda la cola exactamente hasta resumeAt", async () => {
    const pacer = new MarketAssetRequestPacer();
    pacer.observe({
      outcome: "rate_limited",
      validAssets: 0,
      completedAt: START,
      resumeAt: START + 5_000,
    });
    const starts: number[] = [];
    const acquisitions = Array.from({ length: 5 }, () =>
      pacer.acquire().then(() => starts.push(Date.now())),
    );

    await vi.advanceTimersByTimeAsync(4_999);
    expect(starts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toHaveLength(4);
    expect(pacer.getSnapshot().gate).toMatchObject({
      state: "closed",
      reason: null,
      resumeAt: null,
    });
    await vi.advanceTimersByTimeAsync(250);
    await Promise.all(acquisitions);
    expect(starts).toHaveLength(5);
  });

  it("rechaza un 429 sin un resumeAt futuro", () => {
    const pacer = new MarketAssetRequestPacer();
    expect(() =>
      pacer.observe({
        outcome: "rate_limited",
        validAssets: 0,
        completedAt: START,
      }),
    ).toThrow("requiere resumeAt posterior");
  });

  it("reset restaura ritmo, burst y gate sin expulsar workers pendientes", async () => {
    const pacer = new MarketAssetRequestPacer();
    observe(pacer, "server_error", 8);
    const acquisitions = Array.from({ length: 5 }, () => pacer.acquire());
    expect(pacer.getSnapshot()).toMatchObject({
      currentStartsPerSecond: 2,
      queued: 5,
      gate: { state: "open" },
    });

    pacer.reset();
    await flushPromises();
    expect(pacer.getSnapshot()).toMatchObject({
      currentStartsPerSecond: 4,
      acquired: 4,
      observations: 0,
      queued: 1,
      gate: { state: "closed", openCount: 0 },
    });

    await vi.advanceTimersByTimeAsync(250);
    await Promise.all(acquisitions);
    expect(pacer.getSnapshot().queued).toBe(0);
  });

  it("valida configuración y observaciones inválidas", () => {
    expect(
      () =>
        new MarketAssetRequestPacer({
          initialStartsPerSecond: 17,
          maxStartsPerSecond: 16,
        }),
    ).toThrow("debe estar entre");

    const pacer = new MarketAssetRequestPacer();
    expect(() =>
      pacer.observe({
        outcome: "success",
        validAssets: -1,
        completedAt: START,
      }),
    ).toThrow("entero no negativo");
  });
});
