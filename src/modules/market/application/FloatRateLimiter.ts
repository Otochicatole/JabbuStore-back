import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../../../shared/config";

export interface FloatRateLimitHeaders {
  limit: string | null;
  remaining: string | null;
  reset: string | null;
  retryAfter?: string | null;
}

export interface FloatRateLimitSnapshot {
  configuredCapacity: number;
  effectiveCapacity: number;
  availableTokens: number;
  quotaUnitsUsed: number;
  /** Alias histórico. */
  rowsUsed: number;
  cooldownUntil: number;
  windowStartedAt: number;
  windowResetsAt: number;
}

export type FloatRateLimitPriority = "checkout" | "normal" | "sync";

export interface FloatRateLimitAcquireOptions {
  maxWaitMs?: number;
  priority?: FloatRateLimitPriority;
  onWait?: (waitMs: number) => void;
}

export interface FloatRateLimiterClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface FloatRateLimitStateStore {
  load(): Promise<FloatRateLimitSnapshot | null>;
  save(snapshot: FloatRateLimitSnapshot): Promise<void>;
}

const systemClock: FloatRateLimiterClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    error !== undefined &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

/** Estado mínimo compartido por reinicios del proceso único del backend. */
export class FileFloatRateLimitStateStore implements FloatRateLimitStateStore {
  readonly absolutePath: string;

  constructor(
    statePath =
      process.env.FLOAT_SYNC_RATE_LIMIT_STATE_PATH ||
      "steamwebapi-json-data/float-rate-limit-state.json",
  ) {
    this.absolutePath = path.isAbsolute(statePath)
      ? statePath
      : path.resolve(process.cwd(), statePath);
  }

  async load(): Promise<FloatRateLimitSnapshot | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.absolutePath, "utf8"));
    } catch (error) {
      if (isMissingFile(error)) {
        if (await this.recoverNewestBackup()) return this.load();
        return null;
      }
      throw new Error(
        `No se pudo recuperar el estado durable de cuota: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error("El estado durable de cuota no es un objeto válido.");
    }
    const value = parsed as Record<string, unknown>;
    const numeric = (key: string) => Number(value[key]);
    const snapshot: FloatRateLimitSnapshot = {
      configuredCapacity: numeric("configuredCapacity"),
      effectiveCapacity: numeric("effectiveCapacity"),
      availableTokens: numeric("availableTokens"),
      quotaUnitsUsed: numeric("quotaUnitsUsed"),
      rowsUsed: numeric("rowsUsed"),
      cooldownUntil: numeric("cooldownUntil"),
      windowStartedAt: numeric("windowStartedAt"),
      windowResetsAt: numeric("windowResetsAt"),
    };
    if (
      !Object.values(snapshot).every(Number.isFinite) ||
      snapshot.configuredCapacity <= 0 ||
      snapshot.effectiveCapacity <= 0 ||
      snapshot.quotaUnitsUsed < 0 ||
      snapshot.windowStartedAt < 0 ||
      snapshot.windowResetsAt < 0
    ) {
      throw new Error("El estado durable de cuota está corrupto.");
    }
    return snapshot;
  }

  private async recoverNewestBackup(): Promise<boolean> {
    const directory = path.dirname(this.absolutePath);
    const prefix = `${path.basename(this.absolutePath)}.`;
    let names: string[];
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
    const candidates = await Promise.all(
      names
        .filter((name) => name.startsWith(prefix) && name.endsWith(".bak"))
        .map(async (name) => {
          const candidatePath = path.join(directory, name);
          const stat = await fs.stat(candidatePath);
          return { candidatePath, modifiedAt: stat.mtimeMs };
        }),
    );
    const newest = candidates.sort(
      (left, right) => right.modifiedAt - left.modifiedAt,
    )[0];
    if (!newest) return false;
    await fs.rename(newest.candidatePath, this.absolutePath);
    return true;
  }

  async save(snapshot: FloatRateLimitSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.absolutePath), { recursive: true });
    const suffix = `${process.pid}.${randomBytes(6).toString("hex")}`;
    const tempPath = `${this.absolutePath}.${suffix}.tmp`;
    const backupPath = `${this.absolutePath}.${suffix}.bak`;
    try {
      const handle = await fs.open(tempPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(snapshot), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs.rename(tempPath, this.absolutePath);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code ?? "")
            : "";
        if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") {
          throw error;
        }
        let movedPrevious = false;
        try {
          await fs.rename(this.absolutePath, backupPath);
          movedPrevious = true;
        } catch (backupError) {
          if (!isMissingFile(backupError)) throw backupError;
        }
        try {
          await fs.rename(tempPath, this.absolutePath);
          if (movedPrevious) await fs.rm(backupPath, { force: true });
        } catch (replaceError) {
          if (movedPrevious) {
            await fs.rename(backupPath, this.absolutePath).catch(() => undefined);
          }
          throw replaceError;
        }
      }
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function configuredAssetsPerMinute(): number {
  const envValue = readPositiveNumber(
    process.env.FLOAT_SYNC_MAX_ASSETS_PER_MINUTE ??
      process.env.FLOAT_SYNC_MAX_ROWS_PER_MINUTE ??
      process.env.FLOAT_SYNC_MAX_ROWS_PER_MIN,
  );
  return Math.trunc(envValue ?? config.floatSync.maxRowsPerMinute ?? 10_000);
}

function parseResetAt(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const numeric = readPositiveNumber(value);
  if (numeric != null) {
    if (numeric > 10_000_000_000) return Math.trunc(numeric); // epoch ms
    if (numeric > 1_000_000_000) return Math.trunc(numeric * 1_000); // epoch s
    return now + Math.trunc(numeric * 1_000); // segundos restantes
  }

  const parsedDate = Date.parse(value);
  return Number.isFinite(parsedDate) && parsedDate > now ? parsedDate : null;
}

/**
 * Limitador compartido por assets solicitados. Usa una ventana fija de 60 s:
 * una request `limit=10` reserva diez unidades aun si la respuesta trae menos
 * filas o falla después de haber llegado al proveedor.
 */
export class FloatRateLimiter {
  private quotaUnitsUsed = 0;
  private windowStartedAt = 0;
  private windowResetsAt = 0;
  private cooldownUntil = 0;
  private effectiveCapacity: number;
  private checkoutWaiters = 0;
  private readonly configuredCapacity: number;
  private readonly windowMs: number;
  private hydrated = false;
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    maxAssetsPerMinute = configuredAssetsPerMinute(),
    windowMs = readPositiveNumber(process.env.FLOAT_SYNC_RATE_WINDOW_MS) ??
      60_000,
    private readonly clock: FloatRateLimiterClock = systemClock,
    private readonly stateStore?: FloatRateLimitStateStore,
  ) {
    this.configuredCapacity = Math.max(1, Math.trunc(maxAssetsPerMinute));
    this.windowMs = Math.max(1_000, Math.trunc(windowMs));
    this.effectiveCapacity = this.configuredCapacity;
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const saved = await this.stateStore?.load();
    if (saved) {
      this.effectiveCapacity = Math.max(
        1,
        Math.min(this.configuredCapacity, Math.trunc(saved.effectiveCapacity)),
      );
      this.quotaUnitsUsed = Math.max(
        0,
        Math.min(this.effectiveCapacity, Math.trunc(saved.quotaUnitsUsed)),
      );
      this.windowStartedAt = Math.max(0, Math.trunc(saved.windowStartedAt));
      this.windowResetsAt = Math.max(0, Math.trunc(saved.windowResetsAt));
      this.cooldownUntil = Math.max(0, Math.trunc(saved.cooldownUntil));
    }
    this.hydrated = true;
    this.refreshWindow();
  }

  private async persist(): Promise<void> {
    if (this.stateStore) await this.stateStore.save(this.getSnapshot());
  }

  private refreshWindow(): void {
    const now = this.clock.now();
    if (this.windowStartedAt === 0 || now >= this.windowResetsAt) {
      this.quotaUnitsUsed = 0;
      this.windowStartedAt = now;
      this.windowResetsAt = now + this.windowMs;
      if (now >= this.cooldownUntil) this.cooldownUntil = 0;
    }
  }

  async acquire(
    requestedUnits: number,
    options: FloatRateLimitAcquireOptions = {},
  ): Promise<void> {
    if (!Number.isInteger(requestedUnits) || requestedUnits <= 0) {
      throw new Error("La reserva de cuota debe ser un entero positivo.");
    }
    if (requestedUnits > this.configuredCapacity) {
      throw new Error(
        `No se pueden reservar ${requestedUnits} assets: la capacidad configurada es ${this.configuredCapacity}.`,
      );
    }

    const startedAt = this.clock.now();
    const priority = options.priority ?? "normal";
    if (priority === "checkout") this.checkoutWaiters++;

    try {
      for (;;) {
        const decision = await this.runExclusive(async () => {
          await this.hydrate();
          this.refreshWindow();
          const now = this.clock.now();
          const checkoutHasPriority =
            priority === "sync" && this.checkoutWaiters > 0;
          const hasCapacity =
            this.quotaUnitsUsed + requestedUnits <= this.effectiveCapacity;

          if (
            !checkoutHasPriority &&
            now >= this.cooldownUntil &&
            hasCapacity
          ) {
            this.quotaUnitsUsed += requestedUnits;
            // La reserva queda durable antes de permitir la request HTTP.
            await this.persist();
            return { acquired: true as const, waitMs: 0 };
          }

          const blockedUntil = Math.max(
            this.cooldownUntil,
            hasCapacity ? now + 50 : this.windowResetsAt,
          );
          return {
            acquired: false as const,
            waitMs: Math.max(1, blockedUntil - now),
          };
        });
        if (decision.acquired) return;
        const waitMs = decision.waitMs;
        if (
          options.maxWaitMs != null &&
          this.clock.now() - startedAt + waitMs >
            Math.max(0, options.maxWaitMs)
        ) {
          throw new FloatRateLimitWaitTimeoutError(
            Math.max(1, Math.ceil(waitMs / 1_000)),
          );
        }

        if (waitMs >= 1_000) options.onWait?.(waitMs);
        await this.clock.sleep(Math.min(waitMs, 5_000));
      }
    } finally {
      if (priority === "checkout") this.checkoutWaiters--;
    }
  }

  /** Ajusta capacidad, consumo y reset a los headers reales del proveedor. */
  async observeHeaders(headers: FloatRateLimitHeaders): Promise<void> {
    await this.runExclusive(async () => {
      await this.hydrate();
      this.refreshWindow();
      const advertisedLimit = readPositiveNumber(headers.limit);
      if (advertisedLimit != null) {
        this.effectiveCapacity = Math.max(
          1,
          Math.min(this.configuredCapacity, Math.trunc(advertisedLimit)),
        );
        this.quotaUnitsUsed = Math.min(
          this.quotaUnitsUsed,
          this.effectiveCapacity,
        );
      }

      const remaining =
        headers.remaining == null || headers.remaining.trim() === ""
          ? Number.NaN
          : Number(headers.remaining);
      if (Number.isFinite(remaining) && remaining >= 0) {
        this.quotaUnitsUsed = Math.max(
          this.quotaUnitsUsed,
          this.effectiveCapacity -
            Math.min(Math.trunc(remaining), this.effectiveCapacity),
        );
      }

      const resetAt = parseResetAt(headers.reset, this.clock.now());
      if (resetAt != null) this.windowResetsAt = resetAt;
      await this.persist();
    });
  }

  /** Compatibilidad con el cliente anterior. */
  async observeRemaining(remaining: string | null): Promise<void> {
    await this.observeHeaders({ limit: null, remaining, reset: null });
  }

  /** Un 429 consume la ventana y respeta Retry-After/reset. */
  async penalize(
    headers: Partial<FloatRateLimitHeaders> = {
      reset: null,
      retryAfter: null,
    },
  ): Promise<void> {
    await this.runExclusive(async () => {
      await this.hydrate();
      this.refreshWindow();
      const advertisedLimit = readPositiveNumber(headers.limit);
      if (advertisedLimit != null) {
        this.effectiveCapacity = Math.max(
          1,
          Math.min(this.configuredCapacity, Math.trunc(advertisedLimit)),
        );
      }
      const now = this.clock.now();
      const retryAt = parseResetAt(headers.retryAfter, now);
      const resetAt = parseResetAt(headers.reset, now);
      const cooldownUntil = retryAt ?? resetAt ?? now + this.windowMs;

      this.quotaUnitsUsed = this.effectiveCapacity;
      this.cooldownUntil = Math.max(now + 1_000, cooldownUntil);
      this.windowResetsAt = Math.max(
        this.windowResetsAt,
        this.cooldownUntil,
      );
      await this.persist();
    });
  }

  getSnapshot(): FloatRateLimitSnapshot {
    this.refreshWindow();
    return {
      configuredCapacity: this.configuredCapacity,
      effectiveCapacity: this.effectiveCapacity,
      availableTokens: Math.max(
        0,
        this.effectiveCapacity - this.quotaUnitsUsed,
      ),
      quotaUnitsUsed: this.quotaUnitsUsed,
      rowsUsed: this.quotaUnitsUsed,
      cooldownUntil: this.cooldownUntil,
      windowStartedAt: this.windowStartedAt,
      windowResetsAt: this.windowResetsAt,
    };
  }

  async getDurableSnapshot(): Promise<FloatRateLimitSnapshot> {
    return this.runExclusive(async () => {
      await this.hydrate();
      return this.getSnapshot();
    });
  }
}

export class FloatRateLimitWaitTimeoutError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("La cuota de validación de SteamWebAPI está ocupada.");
    this.name = "FloatRateLimitWaitTimeoutError";
  }
}

export const floatRateLimiter = new FloatRateLimiter(
  undefined,
  undefined,
  systemClock,
  new FileFloatRateLimitStateStore(),
);
