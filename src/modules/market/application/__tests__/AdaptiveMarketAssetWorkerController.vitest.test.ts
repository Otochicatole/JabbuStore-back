import { describe, expect, it } from "vitest";
import {
  AdaptiveMarketAssetWorkerController,
  calculateRequiredWorkerConcurrency,
  MARKET_ASSET_CONCURRENCY_STAGES,
  type MarketAssetRequestCompletion,
  type MarketAssetWorkerDemand,
} from "../AdaptiveMarketAssetWorkerController";

const urgentDemand: MarketAssetWorkerDemand = {
  remainingAssets: 10_000,
  remainingMs: 9 * 60_000,
};

function success(
  completedAt: number,
  overrides: Partial<MarketAssetRequestCompletion> = {},
): MarketAssetRequestCompletion {
  return {
    outcome: "success",
    completedAt,
    latencyMs: 10_000,
    validAssets: 5,
    ...overrides,
  } as MarketAssetRequestCompletion;
}

function observeMany(
  controller: AdaptiveMarketAssetWorkerController,
  count: number,
  startAt: number,
  completion: (completedAt: number, index: number) => MarketAssetRequestCompletion =
    (completedAt) => success(completedAt),
  demand = urgentDemand,
) {
  let decision = controller.evaluate(demand, startAt);
  for (let index = 0; index < count; index++) {
    decision = controller.observe(
      completion(startAt + index + 1, index),
      demand,
    );
  }
  return decision;
}

describe("AdaptiveMarketAssetWorkerController", () => {
  it("calcula workers requeridos con 15% de margen y el throughput ocupado", () => {
    expect(
      calculateRequiredWorkerConcurrency({
        remainingAssets: 9_000,
        remainingMs: 9 * 60_000,
        perWorkerAssetsPerMinute: 30,
      }),
    ).toEqual({
      requiredAssetsPerMinute: 1_000,
      requiredConcurrency: 39,
    });
  });

  it("proyecta 39 workers para el perfil real de 10,49 s y 5,25 assets/request", () => {
    const perWorkerAssetsPerMinute = 5.25 / (10.49 / 60);
    const projection = calculateRequiredWorkerConcurrency({
      remainingAssets: 10_000,
      remainingMs: 10 * 60_000,
      perWorkerAssetsPerMinute,
    });

    expect(perWorkerAssetsPerMinute).toBeCloseTo(30.03, 2);
    expect(projection.requiredConcurrency).toBe(39);
    expect(
      (10_000 / (perWorkerAssetsPerMinute * projection.requiredConcurrency)) *
        60,
    ).toBeLessThanOrEqual(600);
  });

  it("el perfil histórico conservador aún proyecta menos de diez minutos al techo", () => {
    const perWorkerAssetsPerMinute = 4.9 / (10.49 / 60);
    const projectedSecondsAtCeiling =
      (10_000 / (perWorkerAssetsPerMinute * 48)) * 60;

    expect(perWorkerAssetsPerMinute).toBeCloseTo(28.03, 2);
    expect(projectedSecondsAtCeiling).toBeLessThanOrEqual(600);
  });

  it("parte en seis y escala por las etapas sólo tras la muestra saludable requerida", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    expect(
      controller.evaluate(urgentDemand, 0).effectiveConcurrency,
    ).toBe(6);

    let now = 0;
    const observedStages: number[] = [];
    const expectedSampleCounts = [20, 20, 28, 42, 64];
    for (const sampleCount of expectedSampleCounts) {
      const decision = observeMany(controller, sampleCount, now);
      now += sampleCount;
      observedStages.push(decision.effectiveConcurrency);
    }

    expect(observedStages).toEqual([9, 14, 21, 32, 48]);
    expect(MARKET_ASSET_CONCURRENCY_STAGES).toEqual([
      6, 9, 14, 21, 32, 48,
    ]);
  });

  it("force-max parte en el máximo y no reduce ni abre el breaker por congestión", () => {
    const controller = new AdaptiveMarketAssetWorkerController({
      initialConcurrency: 6,
      maxConcurrency: 48,
      forceMaxConcurrency: true,
    });

    expect(controller.evaluate(urgentDemand, 0)).toMatchObject({
      state: "running",
      effectiveConcurrency: 48,
      dispatchConcurrency: 48,
    });

    const outcomes = ["timeout", "network_error", "server_error"] as const;
    const decision = observeMany(
      controller,
      96,
      0,
      (completedAt, index) => ({
        outcome: outcomes[index % outcomes.length]!,
        completedAt,
        latencyMs: 60_000,
      }),
    );

    expect(decision).toMatchObject({
      state: "running",
      effectiveConcurrency: 48,
      dispatchConcurrency: 48,
      cooldownUntil: null,
      circuitBreaker: {
        state: "closed",
        openedCount: 0,
      },
    });
    expect(decision.recentCongestionRate).toBe(1);
  });

  it("force-max pausa ante 429 y vuelve directamente al máximo al llegar el reset", () => {
    const controller = new AdaptiveMarketAssetWorkerController({
      forceMaxConcurrency: true,
    });
    let decision = controller.observe(
      {
        outcome: "rate_limited",
        completedAt: 1_000,
        latencyMs: 300,
        resumeAt: 61_000,
      },
      urgentDemand,
    );

    expect(decision).toMatchObject({
      state: "breaker_open",
      effectiveConcurrency: 48,
      dispatchConcurrency: 0,
      circuitBreaker: {
        state: "open",
        reason: "rate_limited",
        resumeAt: 61_000,
      },
    });
    expect(controller.evaluate(urgentDemand, 60_999).state).toBe(
      "breaker_open",
    );

    decision = controller.evaluate(urgentDemand, 61_000);
    expect(decision).toMatchObject({
      state: "running",
      effectiveConcurrency: 48,
      dispatchConcurrency: 48,
      circuitBreaker: {
        state: "closed",
        reason: null,
        probeConcurrency: null,
      },
    });
  });

  it("force-max sigue deteniendo el despacho ante un error fatal", () => {
    const controller = new AdaptiveMarketAssetWorkerController({
      forceMaxConcurrency: true,
    });
    const decision = controller.observe(
      {
        outcome: "fatal",
        completedAt: 100,
        latencyMs: 20,
      },
      urgentDemand,
    );

    expect(decision).toMatchObject({
      state: "halted",
      effectiveConcurrency: 48,
      dispatchConcurrency: 0,
    });
  });

  it("el snapshot conserva force-max y restaura siempre en el máximo", () => {
    const controller = new AdaptiveMarketAssetWorkerController({
      initialConcurrency: 3,
      maxConcurrency: 32,
      forceMaxConcurrency: true,
    });
    observeMany(controller, 10, 0, (completedAt) => ({
      outcome: "timeout",
      completedAt,
      latencyMs: 30_000,
    }));

    const snapshot = JSON.parse(JSON.stringify(controller.toSnapshot()));
    expect(snapshot.forceMaxConcurrency).toBe(true);

    const restored = AdaptiveMarketAssetWorkerController.restore(snapshot);
    const decision = observeMany(
      restored,
      64,
      100,
      (completedAt) => ({
        outcome: "network_error",
        completedAt,
        latencyMs: 30_000,
      }),
    );
    expect(decision).toMatchObject({
      state: "running",
      effectiveConcurrency: 32,
      dispatchConcurrency: 32,
      circuitBreaker: { state: "closed" },
    });
    expect(restored.toSnapshot().forceMaxConcurrency).toBe(true);
  });

  it("force-max ignora cooldown y breaker de congestión de un checkpoint adaptativo", () => {
    const adaptive = new AdaptiveMarketAssetWorkerController();
    observeMany(adaptive, 5, 0, (completedAt) => ({
      outcome: "timeout",
      completedAt,
      latencyMs: 30_000,
    }));
    const checkpoint = adaptive.toCheckpointState();
    expect(checkpoint.circuitBreaker.state).toBe("open");

    const restored =
      AdaptiveMarketAssetWorkerController.restoreFromCheckpoint(checkpoint, {
        maxConcurrency: 48,
        forceMaxConcurrency: true,
      });
    expect(restored.evaluate(urgentDemand, 10)).toMatchObject({
      state: "running",
      effectiveConcurrency: 48,
      dispatchConcurrency: 48,
      cooldownUntil: null,
      circuitBreaker: {
        state: "closed",
        reason: null,
      },
    });
  });

  it("force-max conserva un reset de cuota durable aunque el checkpoint no tenga muestras", () => {
    const resetAt = Date.UTC(2026, 6, 23, 0, 2);
    const checkpoint = {
      initialConcurrency: 2,
      effectiveConcurrency: 2,
      rampStage: 0,
      latencyBaselineMs: null,
      recentHealthSamples: [],
      concurrencyCooldownUntil: null,
      consecutiveCongestionFailures: 0,
      circuitBreaker: {
        state: "open" as const,
        openCount: 1,
        resumeAt: new Date(resetAt).toISOString(),
      },
    };

    const restored =
      AdaptiveMarketAssetWorkerController.restoreFromCheckpoint(checkpoint, {
        maxConcurrency: 48,
        forceMaxConcurrency: true,
      });

    expect(restored.evaluate(urgentDemand, resetAt - 1)).toMatchObject({
      state: "breaker_open",
      effectiveConcurrency: 48,
      dispatchConcurrency: 0,
      circuitBreaker: {
        reason: "rate_limited",
        resumeAt: resetAt,
      },
    });
    expect(restored.evaluate(urgentDemand, resetAt)).toMatchObject({
      state: "running",
      effectiveConcurrency: 48,
      dispatchConcurrency: 48,
      circuitBreaker: { state: "closed", reason: null },
    });
  });

  it("no escala si el throughput actual ya cumple el tiempo restante", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    const relaxedDemand = {
      remainingAssets: 100,
      remainingMs: 10 * 60_000,
    };
    const decision = observeMany(
      controller,
      20,
      0,
      (completedAt) =>
        success(completedAt, { latencyMs: 1_000, validAssets: 10 }),
      relaxedDemand,
    );

    expect(decision.requiredConcurrency).toBe(1);
    expect(decision.effectiveConcurrency).toBe(6);
  });

  it("reduce a la mitad y aplica 45 segundos de cooldown con 10% de congestión", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    const decision = observeMany(controller, 20, 0, (completedAt, index) =>
      index === 3 || index === 12
        ? {
            outcome: "network_error",
            completedAt,
            latencyMs: 10_000,
          }
        : success(completedAt),
    );

    expect(decision).toMatchObject({
      state: "cooldown",
      effectiveConcurrency: 3,
      dispatchConcurrency: 3,
      cooldownUntil: 45_020,
    });
    expect(controller.evaluate(urgentDemand, 45_019).effectiveConcurrency).toBe(
      3,
    );
  });

  it("abre por cinco fallos consecutivos, prueba con dos y cierra tras tres éxitos", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    let decision = observeMany(controller, 5, 0, (completedAt) => ({
      outcome: "timeout",
      completedAt,
      latencyMs: 30_000,
    }));

    expect(decision).toMatchObject({
      state: "breaker_open",
      dispatchConcurrency: 0,
      circuitBreaker: {
        reason: "congestion",
        resumeAt: 15_005,
      },
    });
    decision = controller.evaluate(urgentDemand, 15_005);
    expect(decision).toMatchObject({
      state: "half_open",
      dispatchConcurrency: 2,
    });

    decision = controller.observe(success(15_006), urgentDemand);
    decision = controller.observe(success(15_007), urgentDemand);
    decision = controller.observe(success(15_008), urgentDemand);
    expect(decision).toMatchObject({
      state: "running",
      effectiveConcurrency: 6,
      dispatchConcurrency: 6,
      circuitBreaker: { state: "closed" },
    });
  });

  it("duplica el backoff de congestión hasta 120 segundos", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    observeMany(controller, 5, 0, (completedAt) => ({
      outcome: "timeout",
      completedAt,
      latencyMs: 1_000,
    }));
    controller.evaluate(urgentDemand, 15_005);
    controller.observe(success(15_006), urgentDemand);
    controller.observe(success(15_007), urgentDemand);
    controller.observe(success(15_008), urgentDemand);

    const reopened = observeMany(controller, 5, 16_000, (completedAt) => ({
      outcome: "server_error",
      completedAt,
      latencyMs: 1_000,
    }));
    expect(reopened.circuitBreaker.resumeAt).toBe(46_005);
  });

  it("un 429 usa el reset externo y limita half-open a un solo probe", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    let decision = controller.observe(
      {
        outcome: "rate_limited",
        completedAt: 1_000,
        latencyMs: 300,
        resumeAt: 61_000,
      },
      urgentDemand,
    );
    expect(decision).toMatchObject({
      state: "breaker_open",
      dispatchConcurrency: 0,
      circuitBreaker: {
        reason: "rate_limited",
        resumeAt: 61_000,
      },
    });

    decision = controller.evaluate(urgentDemand, 61_000);
    expect(decision).toMatchObject({
      state: "half_open",
      dispatchConcurrency: 1,
      circuitBreaker: { probeConcurrency: 1 },
    });
    decision = controller.observe(success(61_001), urgentDemand);
    decision = controller.observe(success(61_002), urgentDemand);
    decision = controller.observe(success(61_003), urgentDemand);
    expect(decision.circuitBreaker.state).toBe("closed");
    expect(decision.effectiveConcurrency).toBe(6);
  });

  it("múltiples 429 conservan el reset más lejano y cuentan una sola apertura", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    controller.observe(
      {
        outcome: "rate_limited",
        completedAt: 1_000,
        latencyMs: 300,
        resumeAt: 61_000,
      },
      urgentDemand,
    );
    let decision = controller.observe(
      {
        outcome: "rate_limited",
        completedAt: 1_100,
        latencyMs: 350,
        resumeAt: 31_000,
      },
      urgentDemand,
    );
    expect(decision.circuitBreaker).toMatchObject({
      state: "open",
      openedCount: 1,
      resumeAt: 61_000,
    });

    decision = controller.observe(
      {
        outcome: "rate_limited",
        completedAt: 1_200,
        latencyMs: 400,
        resumeAt: 91_000,
      },
      urgentDemand,
    );
    expect(decision.circuitBreaker).toMatchObject({
      state: "open",
      openedCount: 1,
      resumeAt: 91_000,
    });
  });

  it("construye el baseline sólo con veinte respuestas exitosas", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    observeMany(controller, 10, 0, (completedAt) => ({
      outcome: "candidate_error",
      completedAt,
      latencyMs: 30_000,
    }));
    expect(controller.toSnapshot().baselineLatenciesMs).toEqual([]);

    observeMany(controller, 19, 100, (completedAt) =>
      success(completedAt, { latencyMs: 8_000 }),
    );
    expect(controller.toSnapshot().baselineLatenciesMs).toHaveLength(19);
    expect(controller.toCheckpointState().latencyBaselineMs).toBeNull();

    controller.observe(
      success(200, { latencyMs: 8_000 }),
      urgentDemand,
    );
    expect(controller.toSnapshot().baselineLatenciesMs).toHaveLength(20);
    expect(controller.toCheckpointState().latencyBaselineMs).toBe(8_000);
  });

  it("abre el breaker al llegar a 25% de congestión en la ventana completa", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    const decision = observeMany(controller, 20, 0, (completedAt, index) =>
      index % 4 === 0
        ? {
            outcome: "network_error",
            completedAt,
            latencyMs: 1_000,
          }
        : success(completedAt, { latencyMs: 1_000 }),
    );

    expect(decision).toMatchObject({
      state: "breaker_open",
      dispatchConcurrency: 0,
      circuitBreaker: { reason: "congestion" },
    });
  });

  it("un fatal detiene el despacho y queda durable", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    const decision = controller.observe(
      {
        outcome: "fatal",
        completedAt: 100,
        latencyMs: 20,
      },
      urgentDemand,
    );
    expect(decision).toMatchObject({
      state: "halted",
      dispatchConcurrency: 0,
    });

    const restored = AdaptiveMarketAssetWorkerController.restore(
      JSON.parse(JSON.stringify(controller.toSnapshot())),
    );
    expect(restored.evaluate(urgentDemand, 200)).toMatchObject({
      state: "halted",
      dispatchConcurrency: 0,
      physicalCompletions: 1,
    });
  });

  it("restaura baseline, etapa y circuit breaker sin recalibrar", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    observeMany(controller, 20, 0);
    const before = controller.observe(
      {
        outcome: "rate_limited",
        completedAt: 1_000,
        latencyMs: 100,
        resumeAt: 20_000,
      },
      urgentDemand,
    );
    const restored = AdaptiveMarketAssetWorkerController.restore(
      JSON.parse(JSON.stringify(controller.toSnapshot())),
    );
    const after = restored.evaluate(urgentDemand, 1_000);

    expect(after).toEqual(before);
    expect(restored.toSnapshot()).toEqual(controller.toSnapshot());
  });

  it("expone y restaura la forma plana del checkpoint v4", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    observeMany(controller, 20, Date.UTC(2026, 6, 23));
    controller.observe(
      {
        outcome: "rate_limited",
        completedAt: Date.UTC(2026, 6, 23, 0, 1),
        latencyMs: 100,
        resumeAt: Date.UTC(2026, 6, 23, 0, 2),
      },
      urgentDemand,
    );

    const checkpoint = controller.toCheckpointState();
    expect(checkpoint).toMatchObject({
      initialConcurrency: 6,
      effectiveConcurrency: 9,
      rampStage: 1,
      latencyBaselineMs: 10_000,
      circuitBreaker: {
        state: "open",
        openCount: 1,
        resumeAt: "2026-07-23T00:02:00.000Z",
      },
    });

    const restored =
      AdaptiveMarketAssetWorkerController.restoreFromCheckpoint(checkpoint);
    expect(
      restored.evaluate(urgentDemand, Date.UTC(2026, 6, 23, 0, 1)),
    ).toMatchObject({
      state: "breaker_open",
      effectiveConcurrency: 9,
      dispatchConcurrency: 0,
      baselineP95Ms: 10_000,
      circuitBreaker: {
        reason: "rate_limited",
        resumeAt: Date.UTC(2026, 6, 23, 0, 2),
      },
    });
  });

  it("mantiene incompleto el baseline v4 hasta sumar veinte respuestas físicas", () => {
    const controller = new AdaptiveMarketAssetWorkerController();
    observeMany(controller, 10, Date.UTC(2026, 6, 23));
    const checkpoint = controller.toCheckpointState();
    expect(checkpoint.latencyBaselineMs).toBeNull();

    const restored =
      AdaptiveMarketAssetWorkerController.restoreFromCheckpoint(checkpoint);
    const decision = observeMany(
      restored,
      10,
      Date.UTC(2026, 6, 23, 0, 1),
    );
    expect(decision.baselineP95Ms).toBe(10_000);
    expect(restored.toCheckpointState().latencyBaselineMs).toBe(10_000);
  });
});
