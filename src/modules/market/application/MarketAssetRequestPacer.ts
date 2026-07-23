export type MarketAssetRequestPacerOutcome =
  | "success"
  | "candidate_error"
  | "timeout"
  | "network_error"
  | "server_error"
  | "rate_limited"
  | "fatal";

export interface MarketAssetRequestPacerObservation {
  outcome: MarketAssetRequestPacerOutcome;
  validAssets: number;
  completedAt: number;
  /** Timestamp absoluto. Es obligatorio para una respuesta `rate_limited`. */
  resumeAt?: number;
}

export interface MarketAssetRequestPacerOptions {
  initialStartsPerSecond?: number;
  maxStartsPerSecond?: number;
  minimumStartsPerSecond?: number;
}

export interface MarketAssetRequestPacerSnapshot {
  initialStartsPerSecond: number;
  minimumStartsPerSecond: number;
  maximumStartsPerSecond: number;
  currentStartsPerSecond: number;
  burstLimit: 4;
  queued: number;
  availableTokens: number;
  acquired: number;
  observations: number;
  validAssets: number;
  healthyWindowStreak: number;
  window: {
    size: 48;
    observations: number;
    congestionFailures: number;
    congestionRate: number;
    validAssets: number;
  };
  consecutiveCongestionFailures: number;
  gate: {
    state: "closed" | "open";
    reason: "congestion" | "rate_limited" | null;
    resumeAt: number | null;
    openCount: number;
  };
}

type GateReason = "congestion" | "rate_limited" | null;

interface QueuedAcquire {
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  removeAbortListener: () => void;
}

const FEEDBACK_WINDOW_SIZE = 48;
const BURST_LIMIT = 4;
const DEFAULT_INITIAL_STARTS_PER_SECOND = 4;
const DEFAULT_MAX_STARTS_PER_SECOND = 16;
const DEFAULT_MINIMUM_STARTS_PER_SECOND = 1;
const BASE_CONGESTION_GATE_MS = 2_000;
const MAX_CONGESTION_GATE_MS = 10_000;

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} debe ser un número finito mayor que cero.`);
  }
  return value;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} debe ser un número finito no negativo.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} debe ser un entero no negativo.`);
  }
  return value;
}

function isCongestion(outcome: MarketAssetRequestPacerOutcome): boolean {
  return (
    outcome === "timeout" ||
    outcome === "network_error" ||
    outcome === "server_error"
  );
}

/**
 * Limita únicamente el ritmo de inicio de las requests físicas del sync de
 * assets. El pool puede conservar sus 48 workers lógicos: los que todavía no
 * tienen permiso esperan en esta cola FIFO sin consumir un slot HTTP nuevo.
 */
export class MarketAssetRequestPacer {
  private readonly initialStartsPerSecond: number;
  private readonly minimumStartsPerSecond: number;
  private readonly maximumStartsPerSecond: number;

  private currentStartsPerSecond: number;
  private availableTokens = BURST_LIMIT;
  private lastRefillAt = Date.now();
  private queue: QueuedAcquire[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerDueAt: number | null = null;
  private pumping = false;

  private observationsInWindow = 0;
  private congestionFailuresInWindow = 0;
  private specialFailuresInWindow = 0;
  private validAssetsInWindow = 0;
  private severeActionTakenInWindow = false;
  private consecutiveCongestionFailures = 0;
  private healthyWindowStreak = 0;

  private gateReason: GateReason = null;
  private gateResumeAt = 0;
  private gateOpenCount = 0;
  private congestionBackoffLevel = 0;

  private totalAcquired = 0;
  private totalObservations = 0;
  private totalValidAssets = 0;

  constructor(options: MarketAssetRequestPacerOptions = {}) {
    const maximum = positiveFinite(
      options.maxStartsPerSecond ?? DEFAULT_MAX_STARTS_PER_SECOND,
      "maxStartsPerSecond",
    );
    const minimum = positiveFinite(
      options.minimumStartsPerSecond ??
        DEFAULT_MINIMUM_STARTS_PER_SECOND,
      "minimumStartsPerSecond",
    );
    const initial = positiveFinite(
      options.initialStartsPerSecond ??
        DEFAULT_INITIAL_STARTS_PER_SECOND,
      "initialStartsPerSecond",
    );
    if (minimum > maximum) {
      throw new Error(
        "minimumStartsPerSecond no puede superar maxStartsPerSecond.",
      );
    }
    if (initial < minimum || initial > maximum) {
      throw new Error(
        "initialStartsPerSecond debe estar entre el mínimo y el máximo.",
      );
    }

    this.initialStartsPerSecond = initial;
    this.minimumStartsPerSecond = minimum;
    this.maximumStartsPerSecond = maximum;
    this.currentStartsPerSecond = initial;
  }

  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new MarketAssetRequestPacerCancelledError());
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: QueuedAcquire = {
        settled: false,
        resolve,
        reject,
        removeAbortListener: () => undefined,
      };
      if (signal) {
        const onAbort = () => {
          if (waiter.settled) return;
          waiter.settled = true;
          waiter.removeAbortListener();
          waiter.reject(new MarketAssetRequestPacerCancelledError());
          this.pump();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.removeAbortListener = () =>
          signal.removeEventListener("abort", onAbort);
      }
      this.queue.push(waiter);
      this.pump();
    });
  }

  observe(observation: MarketAssetRequestPacerObservation): void {
    this.validateObservation(observation);
    const congested = isCongestion(observation.outcome);
    const rateLimited = observation.outcome === "rate_limited";

    this.totalObservations++;
    this.totalValidAssets += observation.validAssets;
    this.observationsInWindow++;
    this.validAssetsInWindow += observation.validAssets;
    if (congested) {
      this.congestionFailuresInWindow++;
      this.consecutiveCongestionFailures++;
    } else {
      this.consecutiveCongestionFailures = 0;
    }
    if (rateLimited || observation.outcome === "fatal") {
      this.specialFailuresInWindow++;
    }

    let stateChanged = false;
    if (rateLimited) {
      this.openRateLimitGate(observation.resumeAt!);
      stateChanged = true;
    } else if (this.consecutiveCongestionFailures === 8) {
      this.openCongestionGate(observation.completedAt);
      this.severeActionTakenInWindow = true;
      stateChanged = true;
    }

    if (this.observationsInWindow >= FEEDBACK_WINDOW_SIZE) {
      stateChanged = this.finishFeedbackWindow(observation.completedAt) ||
        stateChanged;
    }
    if (stateChanged) this.reschedulePump();
  }

  getSnapshot(): MarketAssetRequestPacerSnapshot {
    const now = Date.now();
    this.refill(now);
    this.expireGate(now);
    return {
      initialStartsPerSecond: this.initialStartsPerSecond,
      minimumStartsPerSecond: this.minimumStartsPerSecond,
      maximumStartsPerSecond: this.maximumStartsPerSecond,
      currentStartsPerSecond: this.currentStartsPerSecond,
      burstLimit: BURST_LIMIT,
      queued: this.queue.filter((waiter) => !waiter.settled).length,
      availableTokens: Math.max(
        0,
        Math.min(BURST_LIMIT, this.availableTokens),
      ),
      acquired: this.totalAcquired,
      observations: this.totalObservations,
      validAssets: this.totalValidAssets,
      healthyWindowStreak: this.healthyWindowStreak,
      window: {
        size: FEEDBACK_WINDOW_SIZE,
        observations: this.observationsInWindow,
        congestionFailures: this.congestionFailuresInWindow,
        congestionRate:
          this.observationsInWindow === 0
            ? 0
            : this.congestionFailuresInWindow /
              this.observationsInWindow,
        validAssets: this.validAssetsInWindow,
      },
      consecutiveCongestionFailures:
        this.consecutiveCongestionFailures,
      gate: {
        state: this.gateReason == null ? "closed" : "open",
        reason: this.gateReason,
        resumeAt: this.gateReason == null ? null : this.gateResumeAt,
        openCount: this.gateOpenCount,
      },
    };
  }

  /**
   * Restablece feedback, gate y ritmo inicial. Los workers que ya esperan
   * conservan su posición y vuelven a competir inmediatamente por tokens.
   */
  reset(): void {
    const now = Date.now();
    this.currentStartsPerSecond = this.initialStartsPerSecond;
    this.availableTokens = BURST_LIMIT;
    this.lastRefillAt = now;
    this.observationsInWindow = 0;
    this.congestionFailuresInWindow = 0;
    this.specialFailuresInWindow = 0;
    this.validAssetsInWindow = 0;
    this.severeActionTakenInWindow = false;
    this.consecutiveCongestionFailures = 0;
    this.healthyWindowStreak = 0;
    this.gateReason = null;
    this.gateResumeAt = 0;
    this.gateOpenCount = 0;
    this.congestionBackoffLevel = 0;
    this.totalAcquired = 0;
    this.totalObservations = 0;
    this.totalValidAssets = 0;
    this.reschedulePump();
  }

  private finishFeedbackWindow(completedAt: number): boolean {
    const congestionRate =
      this.congestionFailuresInWindow / FEEDBACK_WINDOW_SIZE;
    let stateChanged = false;

    if (congestionRate >= 0.5) {
      this.healthyWindowStreak = 0;
      if (!this.severeActionTakenInWindow) {
        this.openCongestionGate(completedAt);
        stateChanged = true;
      }
    } else if (congestionRate > 0.1) {
      this.healthyWindowStreak = 0;
      if (!this.severeActionTakenInWindow) {
        this.setRate(this.currentStartsPerSecond * 0.75);
        stateChanged = true;
      }
    } else if (
      congestionRate < 0.02 &&
      this.specialFailuresInWindow === 0
    ) {
      this.healthyWindowStreak++;
      if (this.healthyWindowStreak >= 2) {
        this.setRate(this.currentStartsPerSecond * 1.25);
        this.healthyWindowStreak = 0;
        this.congestionBackoffLevel = 0;
        stateChanged = true;
      }
    } else {
      this.healthyWindowStreak = 0;
    }

    this.observationsInWindow = 0;
    this.congestionFailuresInWindow = 0;
    this.specialFailuresInWindow = 0;
    this.validAssetsInWindow = 0;
    this.severeActionTakenInWindow = false;
    return stateChanged;
  }

  private openCongestionGate(completedAt: number): void {
    const now = Math.max(Date.now(), completedAt);
    this.setRate(this.currentStartsPerSecond * 0.5);
    // Reinicia la racha para que una tormenta continua vuelva a abrir el gate
    // tras otros ocho fallos, aplicando 2s → 4s → 8s → 10s. Sin esto, una
    // racha que superaba ocho sólo volvía a frenar al completar 48 respuestas.
    this.consecutiveCongestionFailures = 0;
    this.congestionBackoffLevel++;
    const duration = Math.min(
      MAX_CONGESTION_GATE_MS,
      BASE_CONGESTION_GATE_MS *
        2 ** Math.max(0, this.congestionBackoffLevel - 1),
    );
    const congestionResumeAt = now + duration;
    if (
      this.gateReason !== "rate_limited" ||
      this.gateResumeAt <= now
    ) {
      this.gateReason = "congestion";
    }
    this.gateResumeAt = Math.max(
      this.gateResumeAt,
      congestionResumeAt,
    );
    this.gateOpenCount++;
  }

  private openRateLimitGate(resumeAt: number): void {
    this.gateReason = "rate_limited";
    this.gateResumeAt = Math.max(this.gateResumeAt, resumeAt);
    this.gateOpenCount++;
  }

  private setRate(next: number): void {
    const now = Date.now();
    this.refill(now);
    this.currentStartsPerSecond = Math.max(
      this.minimumStartsPerSecond,
      Math.min(this.maximumStartsPerSecond, next),
    );
  }

  private refill(now: number): void {
    const elapsed = Math.max(0, now - this.lastRefillAt);
    if (elapsed > 0) {
      this.availableTokens = Math.min(
        BURST_LIMIT,
        this.availableTokens +
          (elapsed * this.currentStartsPerSecond) / 1_000,
      );
      this.lastRefillAt = now;
    }
  }

  private expireGate(now: number): void {
    if (this.gateReason != null && now >= this.gateResumeAt) {
      this.gateReason = null;
      this.gateResumeAt = 0;
    }
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const now = Date.now();
      this.refill(now);
      this.expireGate(now);
      this.discardSettledHead();

      if (this.queue.length === 0) {
        this.clearTimer();
        return;
      }
      if (this.gateReason != null) {
        this.schedulePumpAt(this.gateResumeAt);
        return;
      }

      while (this.availableTokens >= 1 && this.queue.length > 0) {
        const waiter = this.queue.shift()!;
        if (waiter.settled) continue;
        waiter.settled = true;
        waiter.removeAbortListener();
        this.availableTokens -= 1;
        this.totalAcquired++;
        waiter.resolve();
        this.discardSettledHead();
      }

      if (this.queue.length === 0) {
        this.clearTimer();
        return;
      }
      const millisecondsUntilToken =
        ((1 - this.availableTokens) / this.currentStartsPerSecond) *
        1_000;
      this.schedulePumpAt(
        now + Math.max(1, Math.ceil(millisecondsUntilToken)),
      );
    } finally {
      this.pumping = false;
    }
  }

  private discardSettledHead(): void {
    while (this.queue[0]?.settled) this.queue.shift();
  }

  private reschedulePump(): void {
    this.clearTimer();
    this.pump();
  }

  private schedulePumpAt(timestamp: number): void {
    const now = Date.now();
    const delay = Math.max(1, Math.ceil(timestamp - now));
    const dueAt = now + delay;
    if (
      this.timer != null &&
      this.timerDueAt != null &&
      this.timerDueAt <= dueAt
    ) {
      return;
    }
    this.clearTimer();
    this.timerDueAt = dueAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerDueAt = null;
      this.pump();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    this.timerDueAt = null;
  }

  private validateObservation(
    observation: MarketAssetRequestPacerObservation,
  ): void {
    finiteNonNegative(observation.completedAt, "completedAt");
    nonNegativeInteger(observation.validAssets, "validAssets");
    if (
      observation.outcome !== "success" &&
      observation.outcome !== "candidate_error" &&
      observation.outcome !== "timeout" &&
      observation.outcome !== "network_error" &&
      observation.outcome !== "server_error" &&
      observation.outcome !== "rate_limited" &&
      observation.outcome !== "fatal"
    ) {
      throw new Error("outcome no es válido.");
    }
    if (observation.outcome === "rate_limited") {
      if (
        observation.resumeAt == null ||
        !Number.isFinite(observation.resumeAt) ||
        observation.resumeAt <= observation.completedAt
      ) {
        throw new Error(
          "Una observación rate_limited requiere resumeAt posterior a completedAt.",
        );
      }
    }
  }
}

export class MarketAssetRequestPacerCancelledError extends Error {
  constructor() {
    super("La espera del ritmo de SteamWebAPI fue cancelada.");
    this.name = "MarketAssetRequestPacerCancelledError";
  }
}
