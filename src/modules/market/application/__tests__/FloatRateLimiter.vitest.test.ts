import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FileFloatRateLimitStateStore,
  FloatRateLimiter,
  FloatRateLimitAcquireCancelledError,
  FloatRateLimitWaitTimeoutError,
  type FloatRateLimiterClock,
} from "../FloatRateLimiter";

class ManualClock implements FloatRateLimiterClock {
  nowMs = 1_000;
  sleeps: number[] = [];

  now(): number {
    return this.nowMs;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.nowMs += ms;
  }
}

class BlockingClock implements FloatRateLimiterClock {
  nowMs = 1_000;
  sleeps: number[] = [];

  now(): number {
    return this.nowMs;
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return new Promise(() => undefined);
  }
}

describe("FloatRateLimiter", () => {
  it("reserva como máximo 10.000 assets y abre una ventana nueva al agotarlos", async () => {
    const clock = new ManualClock();
    const limiter = new FloatRateLimiter(10_000, 60_000, clock);

    await limiter.acquire(9_990);
    await limiter.acquire(10);
    expect(limiter.getSnapshot()).toMatchObject({
      availableTokens: 0,
      quotaUnitsUsed: 10_000,
    });

    const waits: number[] = [];
    await limiter.acquire(1, { onWait: (ms) => waits.push(ms) });

    expect(clock.nowMs).toBe(61_000);
    expect(clock.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(60_000);
    expect(waits[0]).toBe(60_000);
    expect(limiter.getSnapshot()).toMatchObject({
      availableTokens: 9_999,
      quotaUnitsUsed: 1,
      windowStartedAt: 61_000,
      windowResetsAt: 121_000,
    });
  });

  it("reconcilia limit/remaining/reset del proveedor y respeta un 429", async () => {
    const clock = new ManualClock();
    const limiter = new FloatRateLimiter(10_000, 60_000, clock);

    await limiter.acquire(10);
    await limiter.observeHeaders({
      limit: "100",
      remaining: "90",
      reset: "3",
      retryAfter: "2",
    });
    expect(limiter.getSnapshot()).toMatchObject({
      effectiveCapacity: 100,
      availableTokens: 90,
      quotaUnitsUsed: 10,
      windowResetsAt: 4_000,
    });

    await limiter.penalize({ reset: "3", retryAfter: "2" });
    const waits: number[] = [];
    await limiter.acquire(1, { onWait: (ms) => waits.push(ms) });

    // El reset del proveedor (3 s) es posterior a Retry-After (2 s).
    expect(clock.nowMs).toBe(4_000);
    expect(waits[0]).toBe(3_000);
    expect(limiter.getSnapshot()).toMatchObject({
      effectiveCapacity: 100,
      quotaUnitsUsed: 1,
      availableTokens: 99,
    });
  });

  it("falla rápido cuando el caller no puede esperar al próximo reset", async () => {
    const clock = new ManualClock();
    const limiter = new FloatRateLimiter(10, 60_000, clock);
    await limiter.acquire(10);

    await expect(
      limiter.acquire(1, { maxWaitMs: 1_000 }),
    ).rejects.toBeInstanceOf(FloatRateLimitWaitTimeoutError);
    expect(clock.sleeps).toEqual([]);
  });

  it("cancela un waiter sin reservar cuota adicional", async () => {
    const clock = new BlockingClock();
    const limiter = new FloatRateLimiter(10, 60_000, clock);
    await limiter.acquire(9);
    const controller = new AbortController();

    const waiting = limiter.acquire(2, { signal: controller.signal });
    await vi.waitFor(() => expect(clock.sleeps).toEqual([5_000]));
    controller.abort();

    await expect(waiting).rejects.toBeInstanceOf(
      FloatRateLimitAcquireCancelledError,
    );
    expect(limiter.getSnapshot()).toMatchObject({
      quotaUnitsUsed: 9,
      availableTokens: 1,
    });
  });

  it("revalida la ventana después del pacer y no duplica cuota con checkout", async () => {
    const clock = new ManualClock();
    const limiter = new FloatRateLimiter(10, 60_000, clock);
    let releaseAdmission!: () => void;
    const admissionGate = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    const beforeReserve = vi.fn(async () => admissionGate);

    const delayedSync = limiter.acquire(10, {
      priority: "sync",
      beforeReserve,
    });
    await vi.waitFor(() => expect(beforeReserve).toHaveBeenCalledOnce());
    expect(limiter.getSnapshot().quotaUnitsUsed).toBe(0);

    // Checkout consume la ventana que el sync sólo había inspeccionado.
    await limiter.acquire(10, { priority: "checkout" });
    expect(limiter.getSnapshot().quotaUnitsUsed).toBe(10);

    // Checkout también consume la ventana siguiente antes de liberar el pacer.
    clock.nowMs = 61_000;
    await limiter.acquire(10, { priority: "checkout" });
    expect(limiter.getSnapshot()).toMatchObject({
      quotaUnitsUsed: 10,
      windowStartedAt: 61_000,
      windowResetsAt: 121_000,
    });

    releaseAdmission();
    await delayedSync;

    // El sync no suma 10 sobre la ventana ya llena: espera y reserva recién
    // en la tercera ventana, justo antes de que su caller pueda hacer fetch.
    expect(clock.nowMs).toBe(121_000);
    expect(beforeReserve).toHaveBeenCalledTimes(2);
    expect(limiter.getSnapshot()).toMatchObject({
      quotaUnitsUsed: 10,
      windowStartedAt: 121_000,
      windowResetsAt: 181_000,
    });
  });

  it("un 429 posterior nunca acorta un cooldown ya observado", async () => {
    const clock = new ManualClock();
    const limiter = new FloatRateLimiter(100, 60_000, clock);

    await limiter.penalize({ retryAfter: "10" });
    expect(limiter.getSnapshot().cooldownUntil).toBe(11_000);

    await limiter.penalize({ retryAfter: "2" });
    expect(limiter.getSnapshot().cooldownUntil).toBe(11_000);
  });

  it("recupera la ventana durable después de reiniciar el proceso", async () => {
    const clock = new ManualClock();
    const directory = await mkdtemp(path.join(tmpdir(), "jabbu-rate-limit-"));
    try {
      const state = new FileFloatRateLimitStateStore(
        path.join(directory, "window.json"),
      );
      const firstProcess = new FloatRateLimiter(10, 60_000, clock, state);
      await firstProcess.acquire(10);

      // Simula un crash de Windows después de mover el archivo vigente a .bak
      // y antes de instalar el temporal nuevo.
      await rename(state.absolutePath, `${state.absolutePath}.orphan.bak`);

      const restartedProcess = new FloatRateLimiter(10, 60_000, clock, state);
      await expect(
        restartedProcess.acquire(1, { maxWaitMs: 1_000 }),
      ).rejects.toBeInstanceOf(FloatRateLimitWaitTimeoutError);
      expect(restartedProcess.getSnapshot()).toMatchObject({
        quotaUnitsUsed: 10,
        windowResetsAt: 61_000,
      });

      clock.nowMs = 61_000;
      await restartedProcess.acquire(1);
      expect(restartedProcess.getSnapshot()).toMatchObject({
        quotaUnitsUsed: 1,
        windowStartedAt: 61_000,
        windowResetsAt: 121_000,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
