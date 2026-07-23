export const MARKET_ASSET_CONCURRENCY_STAGES = [
  6, 9, 14, 21, 32, 48,
] as const;

export type MarketAssetRequestOutcome =
  | "success"
  | "candidate_error"
  | "timeout"
  | "network_error"
  | "server_error"
  | "rate_limited"
  | "fatal";

export type MarketAssetTransportSuccess = {
  outcome: "success";
  completedAt: number;
  latencyMs: number;
  validAssets: number;
};

export type MarketAssetRateLimitedCompletion = {
  outcome: "rate_limited";
  completedAt: number;
  latencyMs: number;
  validAssets?: number;
  /** Timestamp absoluto provisto por Retry-After o el header de reset. */
  resumeAt: number;
};

export type MarketAssetFailedCompletion = {
  outcome: Exclude<
    MarketAssetRequestOutcome,
    "success" | "rate_limited"
  >;
  completedAt: number;
  latencyMs: number;
  validAssets?: number;
};

export type MarketAssetRequestCompletion =
  | MarketAssetTransportSuccess
  | MarketAssetRateLimitedCompletion
  | MarketAssetFailedCompletion;

export interface MarketAssetWorkerDemand {
  remainingAssets: number;
  /** Tiempo activo restante para el SLO; las pausas se excluyen fuera del controller. */
  remainingMs: number;
}

export interface AdaptiveMarketAssetWorkerControllerOptions {
  initialConcurrency?: number;
  maxConcurrency?: number;
  congestionCooldownMs?: number;
  congestionBackoffMs?: number;
  maxCongestionBackoffMs?: number;
}

export type MarketAssetCircuitBreakerState =
  | "closed"
  | "open"
  | "half_open";

export type MarketAssetCircuitBreakerReason =
  | "rate_limited"
  | "congestion"
  | null;

interface RequestSample {
  outcome: MarketAssetRequestOutcome;
  completedAt: number;
  latencyMs: number;
  validAssets: number;
}

/**
 * Forma plana compatible con los campos adaptativos de
 * `MarketAssetsCollectionCheckpoint` v4.
 */
export interface AdaptiveMarketAssetWorkerCheckpointState {
  initialConcurrency: number;
  effectiveConcurrency: number;
  rampStage: number;
  latencyBaselineMs: number | null;
  recentHealthSamples: Array<{
    recordedAt: string;
    latencyMs: number;
    assetsCollected: number;
    outcome:
      | "success"
      | "candidate_error"
      | "timeout"
      | "network_error"
      | "server_error"
      | "rate_limited";
  }>;
  concurrencyCooldownUntil: string | null;
  consecutiveCongestionFailures: number;
  circuitBreaker: {
    state: MarketAssetCircuitBreakerState;
    openCount: number;
    resumeAt: string | null;
  };
}

export interface AdaptiveMarketAssetWorkerControllerSnapshot {
  version: 1;
  initialConcurrency: number;
  maxConcurrency: number;
  effectiveConcurrency: number;
  congestionCooldownMs: number;
  congestionBackoffMs: number;
  maxCongestionBackoffMs: number;
  baselineLatenciesMs: number[];
  stageSamples: RequestSample[];
  rollingSamples: RequestSample[];
  physicalCompletions: number;
  consecutiveCongestionFailures: number;
  cooldownUntil: number;
  fatalObserved: boolean;
  circuitBreaker: {
    state: MarketAssetCircuitBreakerState;
    reason: MarketAssetCircuitBreakerReason;
    openedCount: number;
    resumeAt: number | null;
    halfOpenSuccesses: number;
    congestionOpenCount: number;
  };
}

export interface AdaptiveMarketAssetWorkerDecision {
  state: "running" | "cooldown" | "breaker_open" | "half_open" | "halted";
  effectiveConcurrency: number;
  dispatchConcurrency: number;
  requiredConcurrency: number;
  perWorkerAssetsPerMinute: number | null;
  requiredAssetsPerMinute: number;
  baselineP95Ms: number | null;
  recentP95Ms: number | null;
  recentCongestionRate: number;
  cooldownUntil: number | null;
  physicalCompletions: number;
  circuitBreaker: {
    state: MarketAssetCircuitBreakerState;
    reason: MarketAssetCircuitBreakerReason;
    openedCount: number;
    resumeAt: number | null;
    halfOpenSuccesses: number;
    probeConcurrency: number | null;
  };
}

const DEFAULT_INITIAL_CONCURRENCY = 6;
const DEFAULT_MAX_CONCURRENCY = 48;
const DEFAULT_CONGESTION_COOLDOWN_MS = 45_000;
const DEFAULT_CONGESTION_BACKOFF_MS = 15_000;
const DEFAULT_MAX_CONGESTION_BACKOFF_MS = 120_000;
const BASELINE_SAMPLE_SIZE = 20;

const isCongestion = (outcome: MarketAssetRequestOutcome): boolean =>
  outcome === "timeout" ||
  outcome === "network_error" ||
  outcome === "server_error";

const isTransportSuccess = (outcome: MarketAssetRequestOutcome): boolean =>
  outcome === "success";

const boundedInteger = (
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} debe ser un entero entre ${minimum} y ${maximum}.`,
    );
  }
  return value;
};

const finiteNonNegative = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} debe ser un número finito no negativo.`);
  }
  return value;
};

export function approximateP95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? null;
}

export function calculateRequiredWorkerConcurrency(input: {
  remainingAssets: number;
  remainingMs: number;
  perWorkerAssetsPerMinute: number | null;
  maxConcurrency?: number;
}): {
  requiredAssetsPerMinute: number;
  requiredConcurrency: number;
} {
  const remainingAssets = Math.max(
    0,
    finiteNonNegative(input.remainingAssets, "remainingAssets"),
  );
  const remainingMs = finiteNonNegative(input.remainingMs, "remainingMs");
  const maxConcurrency = boundedInteger(
    input.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    1,
    DEFAULT_MAX_CONCURRENCY,
    "maxConcurrency",
  );
  if (remainingAssets === 0) {
    return { requiredAssetsPerMinute: 0, requiredConcurrency: 0 };
  }

  const requiredAssetsPerMinute =
    remainingMs > 0
      ? remainingAssets / (remainingMs / 60_000)
      : Number.POSITIVE_INFINITY;
  const perWorkerRate = input.perWorkerAssetsPerMinute;
  const rawRequired =
    perWorkerRate != null &&
    Number.isFinite(perWorkerRate) &&
    perWorkerRate > 0
      ? Math.ceil((requiredAssetsPerMinute / perWorkerRate) * 1.15)
      : maxConcurrency;

  return {
    requiredAssetsPerMinute,
    requiredConcurrency: Math.max(1, Math.min(maxConcurrency, rawRequired)),
  };
}

function cloneSamples(samples: readonly RequestSample[]): RequestSample[] {
  return samples.map((sample) => ({ ...sample }));
}

function validateSamples(value: unknown, label: string): RequestSample[] {
  if (!Array.isArray(value)) throw new Error(`${label} no es un array.`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`${label}[${index}] no es una muestra válida.`);
    }
    const sample = entry as Record<string, unknown>;
    const outcome = sample.outcome;
    if (
      outcome !== "success" &&
      outcome !== "candidate_error" &&
      outcome !== "timeout" &&
      outcome !== "network_error" &&
      outcome !== "server_error" &&
      outcome !== "rate_limited" &&
      outcome !== "fatal"
    ) {
      throw new Error(`${label}[${index}].outcome no es válido.`);
    }
    return {
      outcome,
      completedAt: finiteNonNegative(
        Number(sample.completedAt),
        `${label}[${index}].completedAt`,
      ),
      latencyMs: finiteNonNegative(
        Number(sample.latencyMs),
        `${label}[${index}].latencyMs`,
      ),
      validAssets: boundedInteger(
        Number(sample.validAssets),
        0,
        Number.MAX_SAFE_INTEGER,
        `${label}[${index}].validAssets`,
      ),
    };
  });
}

/**
 * Controlador determinista de concurrencia. No crea workers ni temporizadores:
 * el dispatcher registra cada request física y aplica `dispatchConcurrency`.
 */
export class AdaptiveMarketAssetWorkerController {
  private readonly initialConcurrency: number;
  private readonly maxConcurrency: number;
  private readonly congestionCooldownMs: number;
  private readonly congestionBackoffMs: number;
  private readonly maxCongestionBackoffMs: number;

  private effectiveConcurrency: number;
  private baselineLatenciesMs: number[] = [];
  private stageSamples: RequestSample[] = [];
  private rollingSamples: RequestSample[] = [];
  private physicalCompletions = 0;
  private consecutiveCongestionFailures = 0;
  private cooldownUntil = 0;
  private fatalObserved = false;
  private circuitBreaker: AdaptiveMarketAssetWorkerControllerSnapshot["circuitBreaker"] =
    {
      state: "closed",
      reason: null,
      openedCount: 0,
      resumeAt: null,
      halfOpenSuccesses: 0,
      congestionOpenCount: 0,
    };

  constructor(options: AdaptiveMarketAssetWorkerControllerOptions = {}) {
    this.maxConcurrency = boundedInteger(
      options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      1,
      DEFAULT_MAX_CONCURRENCY,
      "maxConcurrency",
    );
    this.initialConcurrency = boundedInteger(
      options.initialConcurrency ?? DEFAULT_INITIAL_CONCURRENCY,
      1,
      this.maxConcurrency,
      "initialConcurrency",
    );
    this.congestionCooldownMs = boundedInteger(
      options.congestionCooldownMs ?? DEFAULT_CONGESTION_COOLDOWN_MS,
      1,
      Number.MAX_SAFE_INTEGER,
      "congestionCooldownMs",
    );
    this.congestionBackoffMs = boundedInteger(
      options.congestionBackoffMs ?? DEFAULT_CONGESTION_BACKOFF_MS,
      1,
      Number.MAX_SAFE_INTEGER,
      "congestionBackoffMs",
    );
    this.maxCongestionBackoffMs = boundedInteger(
      options.maxCongestionBackoffMs ?? DEFAULT_MAX_CONGESTION_BACKOFF_MS,
      this.congestionBackoffMs,
      Number.MAX_SAFE_INTEGER,
      "maxCongestionBackoffMs",
    );
    this.effectiveConcurrency = this.initialConcurrency;
  }

  static restore(
    snapshot: AdaptiveMarketAssetWorkerControllerSnapshot,
  ): AdaptiveMarketAssetWorkerController {
    if (!snapshot || snapshot.version !== 1) {
      throw new Error("Snapshot del controller adaptativo incompatible.");
    }
    const controller = new AdaptiveMarketAssetWorkerController({
      initialConcurrency: snapshot.initialConcurrency,
      maxConcurrency: snapshot.maxConcurrency,
      congestionCooldownMs: snapshot.congestionCooldownMs,
      congestionBackoffMs: snapshot.congestionBackoffMs,
      maxCongestionBackoffMs: snapshot.maxCongestionBackoffMs,
    });

    controller.effectiveConcurrency = boundedInteger(
      snapshot.effectiveConcurrency,
      1,
      controller.maxConcurrency,
      "effectiveConcurrency",
    );
    controller.baselineLatenciesMs = snapshot.baselineLatenciesMs.map(
      (value, index) =>
        finiteNonNegative(value, `baselineLatenciesMs[${index}]`),
    );
    if (controller.baselineLatenciesMs.length > BASELINE_SAMPLE_SIZE) {
      throw new Error("El baseline contiene más de 20 muestras.");
    }
    controller.stageSamples = validateSamples(
      snapshot.stageSamples,
      "stageSamples",
    );
    controller.rollingSamples = validateSamples(
      snapshot.rollingSamples,
      "rollingSamples",
    ).slice(-DEFAULT_MAX_CONCURRENCY);
    controller.physicalCompletions = boundedInteger(
      snapshot.physicalCompletions,
      0,
      Number.MAX_SAFE_INTEGER,
      "physicalCompletions",
    );
    controller.consecutiveCongestionFailures = boundedInteger(
      snapshot.consecutiveCongestionFailures,
      0,
      Number.MAX_SAFE_INTEGER,
      "consecutiveCongestionFailures",
    );
    controller.cooldownUntil = finiteNonNegative(
      snapshot.cooldownUntil,
      "cooldownUntil",
    );
    controller.fatalObserved = Boolean(snapshot.fatalObserved);

    const breaker = snapshot.circuitBreaker;
    if (
      !breaker ||
      (breaker.state !== "closed" &&
        breaker.state !== "open" &&
        breaker.state !== "half_open") ||
      (breaker.reason !== null &&
        breaker.reason !== "rate_limited" &&
        breaker.reason !== "congestion")
    ) {
      throw new Error("Estado del circuit breaker inválido.");
    }
    controller.circuitBreaker = {
      state: breaker.state,
      reason: breaker.reason,
      openedCount: boundedInteger(
        breaker.openedCount,
        0,
        Number.MAX_SAFE_INTEGER,
        "circuitBreaker.openedCount",
      ),
      resumeAt:
        breaker.resumeAt == null
          ? null
          : finiteNonNegative(
              breaker.resumeAt,
              "circuitBreaker.resumeAt",
            ),
      halfOpenSuccesses: boundedInteger(
        breaker.halfOpenSuccesses,
        0,
        3,
        "circuitBreaker.halfOpenSuccesses",
      ),
      congestionOpenCount: boundedInteger(
        breaker.congestionOpenCount,
        0,
        Number.MAX_SAFE_INTEGER,
        "circuitBreaker.congestionOpenCount",
      ),
    };
    return controller;
  }

  /**
   * Restaura desde el subconjunto persistido por el checkpoint v4. Los campos
   * internos que el formato plano no representa se reconstruyen de manera
   * conservadora para no escalar de más después de un reinicio.
   */
  static restoreFromCheckpoint(
    checkpoint: AdaptiveMarketAssetWorkerCheckpointState,
    options: Omit<
      AdaptiveMarketAssetWorkerControllerOptions,
      "initialConcurrency"
    > = {},
  ): AdaptiveMarketAssetWorkerController {
    const controller = new AdaptiveMarketAssetWorkerController({
      ...options,
      initialConcurrency: checkpoint.initialConcurrency,
    });
    controller.effectiveConcurrency = boundedInteger(
      checkpoint.effectiveConcurrency,
      1,
      controller.maxConcurrency,
      "effectiveConcurrency",
    );
    const baseline =
      checkpoint.latencyBaselineMs == null
        ? null
        : finiteNonNegative(
            checkpoint.latencyBaselineMs,
            "latencyBaselineMs",
          );
    controller.stageSamples = checkpoint.recentHealthSamples
      .slice(-100)
      .map((sample, index) =>
        controller.checkpointSampleToRequestSample(sample, index),
      );
    controller.baselineLatenciesMs =
      baseline == null
        ? controller.stageSamples
            .filter((sample) => isTransportSuccess(sample.outcome))
            .slice(0, BASELINE_SAMPLE_SIZE)
            .map((sample) => sample.latencyMs)
        : Array.from({ length: BASELINE_SAMPLE_SIZE }, () => baseline);
    controller.rollingSamples = controller.stageSamples.slice(
      -DEFAULT_MAX_CONCURRENCY,
    );
    controller.physicalCompletions = controller.stageSamples.length;
    controller.consecutiveCongestionFailures = boundedInteger(
      checkpoint.consecutiveCongestionFailures,
      0,
      Number.MAX_SAFE_INTEGER,
      "consecutiveCongestionFailures",
    );
    controller.cooldownUntil =
      checkpoint.concurrencyCooldownUntil == null
        ? 0
        : controller.parseIsoTimestamp(
            checkpoint.concurrencyCooldownUntil,
            "concurrencyCooldownUntil",
          );

    const resumeAt =
      checkpoint.circuitBreaker.resumeAt == null
        ? null
        : controller.parseIsoTimestamp(
            checkpoint.circuitBreaker.resumeAt,
            "circuitBreaker.resumeAt",
          );
    const mostRecentFailure = [...controller.stageSamples]
      .reverse()
      .find((sample) => sample.outcome !== "success");
    const reason: MarketAssetCircuitBreakerReason =
      checkpoint.circuitBreaker.state === "closed"
        ? null
        : mostRecentFailure?.outcome === "rate_limited"
          ? "rate_limited"
          : "congestion";
    let trailingSuccesses = 0;
    if (checkpoint.circuitBreaker.state === "half_open") {
      for (
        let index = controller.stageSamples.length - 1;
        index >= 0;
        index--
      ) {
        if (controller.stageSamples[index]?.outcome !== "success") break;
        trailingSuccesses++;
      }
    }
    controller.circuitBreaker = {
      state: checkpoint.circuitBreaker.state,
      reason,
      openedCount: boundedInteger(
        checkpoint.circuitBreaker.openCount,
        0,
        Number.MAX_SAFE_INTEGER,
        "circuitBreaker.openCount",
      ),
      resumeAt,
      halfOpenSuccesses: Math.min(2, trailingSuccesses),
      congestionOpenCount:
        reason === "congestion" ? checkpoint.circuitBreaker.openCount : 0,
    };
    return controller;
  }

  observe(
    completion: MarketAssetRequestCompletion,
    demand: MarketAssetWorkerDemand,
  ): AdaptiveMarketAssetWorkerDecision {
    this.validateCompletion(completion);
    this.validateDemand(demand);

    const validAssets = completion.validAssets ?? 0;
    const sample: RequestSample = {
      outcome: completion.outcome,
      completedAt: completion.completedAt,
      latencyMs: completion.latencyMs,
      validAssets,
    };
    this.physicalCompletions++;
    if (
      isTransportSuccess(completion.outcome) &&
      this.baselineLatenciesMs.length < BASELINE_SAMPLE_SIZE
    ) {
      this.baselineLatenciesMs.push(completion.latencyMs);
    }
    this.stageSamples.push(sample);
    const stageCapacity = Math.max(20, this.effectiveConcurrency * 2);
    if (this.stageSamples.length > stageCapacity) {
      this.stageSamples.splice(0, this.stageSamples.length - stageCapacity);
    }
    this.rollingSamples.push(sample);
    if (this.rollingSamples.length > DEFAULT_MAX_CONCURRENCY) {
      this.rollingSamples.shift();
    }

    if (isCongestion(completion.outcome)) {
      this.consecutiveCongestionFailures++;
    } else {
      this.consecutiveCongestionFailures = 0;
    }

    if (completion.outcome === "fatal") {
      this.fatalObserved = true;
    } else if (completion.outcome === "rate_limited") {
      this.openRateLimitBreaker(completion.completedAt, completion.resumeAt);
    } else if (this.circuitBreaker.state === "half_open") {
      if (isTransportSuccess(completion.outcome)) {
        this.circuitBreaker.halfOpenSuccesses++;
        if (this.circuitBreaker.halfOpenSuccesses >= 3) {
          this.closeCircuitBreaker();
        }
      } else if (isCongestion(completion.outcome)) {
        this.openCongestionBreaker(completion.completedAt);
      }
    } else if (this.circuitBreaker.state === "closed") {
      const recent = this.recentWindow();
      const rollingWindowIsFull =
        recent.length >= Math.max(20, this.effectiveConcurrency);
      if (
        this.consecutiveCongestionFailures >= 5 ||
        (rollingWindowIsFull && this.congestionRate(recent) >= 0.25)
      ) {
        this.openCongestionBreaker(completion.completedAt);
      }
    }

    return this.evaluate(demand, completion.completedAt);
  }

  evaluate(
    demand: MarketAssetWorkerDemand,
    now: number,
  ): AdaptiveMarketAssetWorkerDecision {
    this.validateDemand(demand);
    finiteNonNegative(now, "now");

    if (
      !this.fatalObserved &&
      this.circuitBreaker.state === "open" &&
      this.circuitBreaker.resumeAt != null &&
      now >= this.circuitBreaker.resumeAt
    ) {
      this.circuitBreaker.state = "half_open";
      this.circuitBreaker.halfOpenSuccesses = 0;
    }

    const throughput = this.throughput();
    const requirement = calculateRequiredWorkerConcurrency({
      ...demand,
      perWorkerAssetsPerMinute: throughput,
      maxConcurrency: this.maxConcurrency,
    });

    if (
      !this.fatalObserved &&
      this.circuitBreaker.state === "closed" &&
      now >= this.cooldownUntil
    ) {
      if (!this.reduceForCongestion(now)) {
        this.increaseForHealthyDemand(requirement.requiredConcurrency);
      }
    }

    return this.decision(requirement, throughput, now);
  }

  toSnapshot(): AdaptiveMarketAssetWorkerControllerSnapshot {
    return {
      version: 1,
      initialConcurrency: this.initialConcurrency,
      maxConcurrency: this.maxConcurrency,
      effectiveConcurrency: this.effectiveConcurrency,
      congestionCooldownMs: this.congestionCooldownMs,
      congestionBackoffMs: this.congestionBackoffMs,
      maxCongestionBackoffMs: this.maxCongestionBackoffMs,
      baselineLatenciesMs: [...this.baselineLatenciesMs],
      stageSamples: cloneSamples(this.stageSamples),
      rollingSamples: cloneSamples(this.rollingSamples),
      physicalCompletions: this.physicalCompletions,
      consecutiveCongestionFailures: this.consecutiveCongestionFailures,
      cooldownUntil: this.cooldownUntil,
      fatalObserved: this.fatalObserved,
      circuitBreaker: { ...this.circuitBreaker },
    };
  }

  toCheckpointState(): AdaptiveMarketAssetWorkerCheckpointState {
    const effectiveStage = MARKET_ASSET_CONCURRENCY_STAGES.reduce(
      (found, concurrency, index) =>
        concurrency <= this.effectiveConcurrency ? index : found,
      0,
    );
    const healthSamples = this.stageSamples.slice(-100).map((sample) => ({
      recordedAt: new Date(sample.completedAt).toISOString(),
      latencyMs: sample.latencyMs,
      assetsCollected: sample.validAssets,
      outcome:
        sample.outcome === "fatal" ? ("candidate_error" as const) : sample.outcome,
    }));
    return {
      initialConcurrency: this.initialConcurrency,
      effectiveConcurrency: this.effectiveConcurrency,
      rampStage: effectiveStage,
      latencyBaselineMs:
        this.baselineLatenciesMs.length >= BASELINE_SAMPLE_SIZE
          ? approximateP95(this.baselineLatenciesMs)
          : null,
      recentHealthSamples: healthSamples,
      concurrencyCooldownUntil:
        this.cooldownUntil > 0
          ? new Date(this.cooldownUntil).toISOString()
          : null,
      consecutiveCongestionFailures: this.consecutiveCongestionFailures,
      circuitBreaker: {
        state: this.circuitBreaker.state,
        openCount: this.circuitBreaker.openedCount,
        resumeAt:
          this.circuitBreaker.resumeAt == null
            ? null
            : new Date(this.circuitBreaker.resumeAt).toISOString(),
      },
    };
  }

  private throughput(): number | null {
    const samples = this.recentWindow();
    const occupiedMinutes =
      samples.reduce((sum, sample) => sum + sample.latencyMs, 0) / 60_000;
    if (occupiedMinutes <= 0) return null;
    const validAssets = samples.reduce(
      (sum, sample) => sum + sample.validAssets,
      0,
    );
    return validAssets > 0 ? validAssets / occupiedMinutes : 0;
  }

  private recentWindow(): RequestSample[] {
    const size = Math.max(20, this.effectiveConcurrency);
    return this.rollingSamples.slice(-size);
  }

  private congestionRate(samples: readonly RequestSample[]): number {
    if (samples.length === 0) return 0;
    return (
      samples.filter((sample) => isCongestion(sample.outcome)).length /
      samples.length
    );
  }

  private increaseForHealthyDemand(requiredConcurrency: number): void {
    if (
      this.effectiveConcurrency >= this.maxConcurrency ||
      requiredConcurrency <= this.effectiveConcurrency ||
      this.baselineLatenciesMs.length < BASELINE_SAMPLE_SIZE
    ) {
      return;
    }
    const requiredSamples = Math.max(20, this.effectiveConcurrency * 2);
    if (this.stageSamples.length < requiredSamples) return;

    const stageWindow = this.stageSamples.slice(-requiredSamples);
    const baselineP95 = approximateP95(this.baselineLatenciesMs);
    const stageP95 = approximateP95(
      stageWindow.map((sample) => sample.latencyMs),
    );
    if (baselineP95 == null || stageP95 == null) return;
    const maximumHealthyP95 = Math.min(
      25_000,
      Math.max(baselineP95 * 1.75, baselineP95 + 5_000),
    );
    if (
      this.congestionRate(stageWindow) > 0.05 ||
      stageP95 > maximumHealthyP95 ||
      stageWindow.some(
        (sample) =>
          sample.outcome === "rate_limited" || sample.outcome === "fatal",
      )
    ) {
      return;
    }

    const nextStage = MARKET_ASSET_CONCURRENCY_STAGES.find(
      (stage) =>
        stage > this.effectiveConcurrency && stage <= this.maxConcurrency,
    );
    const nextConcurrency = nextStage ?? this.maxConcurrency;
    if (nextConcurrency <= this.effectiveConcurrency) return;
    this.effectiveConcurrency = nextConcurrency;
    this.stageSamples = [];
  }

  private reduceForCongestion(now: number): boolean {
    const recent = this.recentWindow();
    const requiredWindow = Math.max(20, this.effectiveConcurrency);
    if (recent.length < requiredWindow) return false;
    const baselineP95 = approximateP95(this.baselineLatenciesMs);
    const recentP95 = approximateP95(
      recent.map((sample) => sample.latencyMs),
    );
    const shouldReduce =
      this.congestionRate(recent) >= 0.1 ||
      (baselineP95 != null &&
        recentP95 != null &&
        recentP95 > baselineP95 * 2) ||
      (recentP95 != null && recentP95 >= 25_000);
    if (!shouldReduce) return false;

    this.effectiveConcurrency = Math.max(
      1,
      Math.ceil(this.effectiveConcurrency / 2),
    );
    this.cooldownUntil = now + this.congestionCooldownMs;
    this.stageSamples = [];
    this.rollingSamples = [];
    return true;
  }

  private openRateLimitBreaker(now: number, resumeAt: number): void {
    if (!Number.isFinite(resumeAt) || resumeAt <= now) {
      throw new Error("resumeAt de un 429 debe ser posterior a completedAt.");
    }
    const isTransition = this.circuitBreaker.state !== "open";
    this.circuitBreaker = {
      ...this.circuitBreaker,
      state: "open",
      reason: "rate_limited",
      openedCount:
        this.circuitBreaker.openedCount + (isTransition ? 1 : 0),
      resumeAt: Math.max(
        this.circuitBreaker.resumeAt ?? 0,
        resumeAt,
      ),
      halfOpenSuccesses: 0,
    };
  }

  private openCongestionBreaker(now: number): void {
    const congestionOpenCount = this.circuitBreaker.congestionOpenCount + 1;
    const backoffMs = Math.min(
      this.maxCongestionBackoffMs,
      this.congestionBackoffMs * 2 ** (congestionOpenCount - 1),
    );
    this.circuitBreaker = {
      state: "open",
      reason: "congestion",
      openedCount: this.circuitBreaker.openedCount + 1,
      resumeAt: now + backoffMs,
      halfOpenSuccesses: 0,
      congestionOpenCount,
    };
  }

  private closeCircuitBreaker(): void {
    this.circuitBreaker = {
      ...this.circuitBreaker,
      state: "closed",
      reason: null,
      resumeAt: null,
      halfOpenSuccesses: 0,
    };
    this.effectiveConcurrency = Math.min(
      this.initialConcurrency,
      this.maxConcurrency,
    );
    this.consecutiveCongestionFailures = 0;
    this.cooldownUntil = 0;
    this.stageSamples = [];
    this.rollingSamples = [];
  }

  private decision(
    requirement: {
      requiredAssetsPerMinute: number;
      requiredConcurrency: number;
    },
    throughput: number | null,
    now: number,
  ): AdaptiveMarketAssetWorkerDecision {
    const recent = this.recentWindow();
    const breaker = this.circuitBreaker;
    const probeConcurrency =
      breaker.state === "half_open"
        ? breaker.reason === "rate_limited"
          ? 1
          : 2
        : null;
    const state = this.fatalObserved
      ? "halted"
      : breaker.state === "open"
        ? "breaker_open"
        : breaker.state === "half_open"
          ? "half_open"
          : now < this.cooldownUntil
            ? "cooldown"
            : "running";
    const dispatchConcurrency = this.fatalObserved
      ? 0
      : breaker.state === "open"
        ? 0
        : probeConcurrency ?? this.effectiveConcurrency;

    return {
      state,
      effectiveConcurrency: this.effectiveConcurrency,
      dispatchConcurrency,
      requiredConcurrency: requirement.requiredConcurrency,
      perWorkerAssetsPerMinute: throughput,
      requiredAssetsPerMinute: requirement.requiredAssetsPerMinute,
      baselineP95Ms: approximateP95(this.baselineLatenciesMs),
      recentP95Ms: approximateP95(
        recent.map((sample) => sample.latencyMs),
      ),
      recentCongestionRate: this.congestionRate(recent),
      cooldownUntil:
        this.cooldownUntil > now ? this.cooldownUntil : null,
      physicalCompletions: this.physicalCompletions,
      circuitBreaker: {
        state: breaker.state,
        reason: breaker.reason,
        openedCount: breaker.openedCount,
        resumeAt: breaker.resumeAt,
        halfOpenSuccesses: breaker.halfOpenSuccesses,
        probeConcurrency,
      },
    };
  }

  private validateDemand(demand: MarketAssetWorkerDemand): void {
    finiteNonNegative(demand.remainingAssets, "remainingAssets");
    finiteNonNegative(demand.remainingMs, "remainingMs");
  }

  private validateCompletion(completion: MarketAssetRequestCompletion): void {
    finiteNonNegative(completion.completedAt, "completedAt");
    finiteNonNegative(completion.latencyMs, "latencyMs");
    boundedInteger(
      completion.validAssets ?? 0,
      0,
      Number.MAX_SAFE_INTEGER,
      "validAssets",
    );
  }

  private checkpointSampleToRequestSample(
    sample: AdaptiveMarketAssetWorkerCheckpointState["recentHealthSamples"][number],
    index: number,
  ): RequestSample {
    if (
      sample.outcome !== "success" &&
      sample.outcome !== "candidate_error" &&
      sample.outcome !== "timeout" &&
      sample.outcome !== "network_error" &&
      sample.outcome !== "server_error" &&
      sample.outcome !== "rate_limited"
    ) {
      throw new Error(`recentHealthSamples[${index}].outcome no es válido.`);
    }
    return {
      outcome: sample.outcome,
      completedAt: this.parseIsoTimestamp(
        sample.recordedAt,
        `recentHealthSamples[${index}].recordedAt`,
      ),
      latencyMs: finiteNonNegative(
        sample.latencyMs,
        `recentHealthSamples[${index}].latencyMs`,
      ),
      validAssets: boundedInteger(
        sample.assetsCollected,
        0,
        Number.MAX_SAFE_INTEGER,
        `recentHealthSamples[${index}].assetsCollected`,
      ),
    };
  }

  private parseIsoTimestamp(value: string, label: string): number {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${label} no es una fecha ISO válida.`);
    }
    return parsed;
  }
}
