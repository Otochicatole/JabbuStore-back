import { createHash, randomBytes } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import {
  MARKET_ASSETS_CATALOG_SCHEMA_VERSION,
  MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION,
  MARKET_ASSETS_MAX_HEALTH_SAMPLES,
  MARKET_ASSETS_MAX_WORKER_CONCURRENCY,
  type IMarketAssetsCatalogStore,
  type MarketAssetCatalogItem,
  type MarketAssetsCandidateCheckpoint,
  type MarketAssetsCatalogFileStatus,
  type MarketAssetsCatalogSnapshot,
  type MarketAssetsCheckpointFileStatus,
  type MarketAssetsCollectionCheckpoint,
  type MarketAssetsWorkerHealthSample,
} from "../domain/MarketAssetsCatalog";

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isSort(value: unknown): boolean {
  return (
    value === "newest" ||
    value === "oldest" ||
    value === "lowest_float" ||
    value === "highest_float"
  );
}

export function isValidMarketAssetCatalogItem(
  value: unknown,
): value is MarketAssetCatalogItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.assetId === "string" &&
    value.assetId.length > 0 &&
    typeof value.externalId === "string" &&
    value.externalId.length > 0 &&
    typeof value.marketHashName === "string" &&
    value.marketHashName.length > 0 &&
    typeof value.listingName === "string" &&
    value.listingName.length > 0 &&
    typeof value.floatValue === "number" &&
    Number.isFinite(value.floatValue) &&
    value.floatValue >= 0 &&
    value.floatValue <= 1 &&
    isNonNegativeInteger(value.paintSeed) &&
    typeof value.price === "number" &&
    Number.isFinite(value.price) &&
    value.price > 0 &&
    (value.inspectLink === null || typeof value.inspectLink === "string") &&
    typeof value.iconUrl === "string" &&
    /^https?:\/\//i.test(value.iconUrl) &&
    typeof value.rarity === "string" &&
    (value.exterior === null || typeof value.exterior === "string") &&
    typeof value.category === "string" &&
    typeof value.isStatTrak === "boolean" &&
    typeof value.isSouvenir === "boolean"
  );
}

export function parseMarketAssetsCatalogSnapshot(
  value: unknown,
): MarketAssetsCatalogSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== MARKET_ASSETS_CATALOG_SCHEMA_VERSION ||
    !isHash(value.version) ||
    !isIsoDate(value.fetchedAt) ||
    value.source !== "youpin" ||
    typeof value.sourceUrl !== "string" ||
    /(?:\?|&)key=/i.test(value.sourceUrl) ||
    !isSort(value.sort) ||
    !isPositiveInteger(value.requestedLimit) ||
    !isNonNegativeInteger(value.providerTotal) ||
    !isNonNegativeInteger(value.rawAssetCount) ||
    !isNonNegativeInteger(value.validAssetCount) ||
    !isNonNegativeInteger(value.skippedAssetCount) ||
    (value.completionReason !== "target_reached" &&
      value.completionReason !== "catalog_exhausted") ||
    !Array.isArray(value.assets) ||
    !value.assets.every(isValidMarketAssetCatalogItem)
  ) {
    return null;
  }
  if (
    value.validAssetCount !== value.assets.length ||
    value.rawAssetCount !== value.validAssetCount + value.skippedAssetCount
  ) {
    return null;
  }
  if (new Set(value.assets.map((asset: any) => asset.assetId)).size !== value.assets.length) {
    return null;
  }

  const expectedVersion = createHash("sha256")
    .update(JSON.stringify(value.assets))
    .digest("hex");
  return value.version === expectedVersion
    ? (value as MarketAssetsCatalogSnapshot)
    : null;
}

function isCandidateCheckpoint(
  value: unknown,
): value is MarketAssetsCandidateCheckpoint {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.initialLimit) &&
    value.initialLimit <= 10 &&
    isNonNegativeInteger(value.offset) &&
    isNonNegativeInteger(value.validAssetCount) &&
    isNonNegativeInteger(value.rawAssetCount) &&
    isNonNegativeInteger(value.skippedAssetCount) &&
    isNonNegativeInteger(value.quotaUnitsUsed) &&
    typeof value.creditsUsed === "number" &&
    Number.isFinite(value.creditsUsed) &&
    value.creditsUsed >= 0 &&
    isNonNegativeInteger(value.providerTotal) &&
    isNonNegativeInteger(value.consecutiveFailures) &&
    isNonNegativeInteger(value.pageRequests) &&
    isNonNegativeInteger(value.httpAttempts) &&
    value.httpAttempts >= value.pageRequests &&
    isNonNegativeInteger(value.deferredRecoveryAttempts) &&
    typeof value.completed === "boolean" &&
    typeof value.exhausted === "boolean" &&
    (value.lastError === null || typeof value.lastError === "string") &&
    value.rawAssetCount ===
      value.validAssetCount + value.skippedAssetCount
  );
}

function isWorkerHealthSample(
  value: unknown,
): value is MarketAssetsWorkerHealthSample {
  return (
    isRecord(value) &&
    isIsoDate(value.recordedAt) &&
    typeof value.latencyMs === "number" &&
    Number.isFinite(value.latencyMs) &&
    value.latencyMs >= 0 &&
    isNonNegativeInteger(value.assetsCollected) &&
    (value.outcome === "success" ||
      value.outcome === "candidate_error" ||
      value.outcome === "timeout" ||
      value.outcome === "network_error" ||
      value.outcome === "server_error" ||
      value.outcome === "rate_limited")
  );
}

function clampWorkerConcurrency(value: unknown, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  return Math.max(
    1,
    Math.min(
      MARKET_ASSETS_MAX_WORKER_CONCURRENCY,
      Number.isFinite(parsed) && parsed > 0 ? parsed : fallback,
    ),
  );
}

function deadlineFromStartedAt(
  startedAt: unknown,
  targetDurationSeconds: number,
): string {
  const startedAtMs =
    typeof startedAt === "string" ? Date.parse(startedAt) : Number.NaN;
  return new Date(
    (Number.isFinite(startedAtMs) ? startedAtMs : 0) +
      targetDurationSeconds * 1_000,
  ).toISOString();
}

/** Migra checkpoints v2 a la forma v3 intermedia sin perder progreso. */
function migrateCheckpointV2(value: Record<string, any>): Record<string, any> {
  if (value.schemaVersion !== 2) return value;
  const candidateProgress = isRecord(value.candidateProgress)
    ? Object.fromEntries(
        Object.entries(value.candidateProgress).map(([key, rawProgress]) => {
          const progress = isRecord(rawProgress) ? rawProgress : {};
          return [
            key,
            {
              ...progress,
              initialLimit: 0,
              pageRequests: 0,
              httpAttempts: 0,
              deferredRecoveryAttempts: 0,
            },
          ];
        }),
      )
    : value.candidateProgress;
  return {
    ...value,
    schemaVersion: 3,
    runId: null,
    effectiveConcurrency: Math.max(
      1,
      Math.min(3, Math.trunc(Number(value.concurrency) || 1)),
    ),
    successfulBatchesSinceReduction: 0,
    adaptiveFailureRounds: 0,
    candidateProgress,
  };
}

/** Migra checkpoints v3 al controlador durable v4 sin perder assets/offsets/runId. */
function migrateCheckpointV3(value: Record<string, any>): Record<string, any> {
  if (value.schemaVersion !== 3) return value;
  const concurrency = clampWorkerConcurrency(value.concurrency, 48);
  const initialConcurrency = Math.min(6, concurrency);
  const effectiveConcurrency = Math.min(
    concurrency,
    clampWorkerConcurrency(value.effectiveConcurrency, initialConcurrency),
  );
  const targetDurationSeconds = 600;
  const targetDeadlineAt = deadlineFromStartedAt(
    value.startedAt,
    targetDurationSeconds,
  );
  const updatedAtMs =
    typeof value.updatedAt === "string"
      ? Date.parse(value.updatedAt)
      : Number.NaN;

  return {
    ...value,
    schemaVersion: MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION,
    concurrency,
    initialConcurrency,
    effectiveConcurrency,
    rampStage: 0,
    latencyBaselineMs: null,
    recentHealthSamples: [],
    concurrencyCooldownUntil: null,
    consecutiveCongestionFailures: 0,
    circuitBreaker: {
      state: "closed",
      openCount: 0,
      resumeAt: null,
    },
    targetDurationSeconds,
    targetDeadlineAt,
    tenMinuteTargetUnreachable:
      Number.isFinite(updatedAtMs) &&
      updatedAtMs > Date.parse(targetDeadlineAt),
  };
}

export function parseMarketAssetsCollectionCheckpoint(
  value: unknown,
): MarketAssetsCollectionCheckpoint | null {
  if (!isRecord(value)) return null;
  value = migrateCheckpointV2(value);
  if (!isRecord(value)) return null;
  value = migrateCheckpointV3(value);
  // La reasignación pierde el narrowing de TypeScript aunque la migración
  // siempre devuelva un record; mantener la validación explícita evita casts.
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION ||
    (value.runId !== null && typeof value.runId !== "string") ||
    !isHash(value.queueVersion) ||
    !isPositiveInteger(value.targetAssets) ||
    !isPositiveInteger(value.assetsPerItem) ||
    value.assetsPerItem > 10 ||
    !isSort(value.sort) ||
    !isPositiveInteger(value.concurrency) ||
    value.concurrency > MARKET_ASSETS_MAX_WORKER_CONCURRENCY ||
    !isPositiveInteger(value.initialConcurrency) ||
    value.initialConcurrency > value.concurrency ||
    !isPositiveInteger(value.effectiveConcurrency) ||
    value.effectiveConcurrency > value.concurrency ||
    value.effectiveConcurrency > MARKET_ASSETS_MAX_WORKER_CONCURRENCY ||
    !isNonNegativeInteger(value.rampStage) ||
    value.rampStage > 5 ||
    (value.latencyBaselineMs !== null &&
      (typeof value.latencyBaselineMs !== "number" ||
        !Number.isFinite(value.latencyBaselineMs) ||
        value.latencyBaselineMs < 0)) ||
    !Array.isArray(value.recentHealthSamples) ||
    value.recentHealthSamples.length > MARKET_ASSETS_MAX_HEALTH_SAMPLES ||
    !value.recentHealthSamples.every(isWorkerHealthSample) ||
    (value.concurrencyCooldownUntil !== null &&
      !isIsoDate(value.concurrencyCooldownUntil)) ||
    !isNonNegativeInteger(value.consecutiveCongestionFailures) ||
    !isRecord(value.circuitBreaker) ||
    (value.circuitBreaker.state !== "closed" &&
      value.circuitBreaker.state !== "open" &&
      value.circuitBreaker.state !== "half_open") ||
    !isNonNegativeInteger(value.circuitBreaker.openCount) ||
    (value.circuitBreaker.resumeAt !== null &&
      !isIsoDate(value.circuitBreaker.resumeAt)) ||
    (value.circuitBreaker.state === "open" &&
      value.circuitBreaker.resumeAt === null) ||
    !isPositiveInteger(value.targetDurationSeconds) ||
    !isIsoDate(value.targetDeadlineAt) ||
    typeof value.tenMinuteTargetUnreachable !== "boolean" ||
    !isNonNegativeInteger(value.successfulBatchesSinceReduction) ||
    !isNonNegativeInteger(value.adaptiveFailureRounds) ||
    !isNonNegativeInteger(value.cursorIndex) ||
    !isNonNegativeInteger(value.candidatesVisited) ||
    !isNonNegativeInteger(value.totalCandidates) ||
    value.cursorIndex > value.totalCandidates ||
    value.candidatesVisited > value.totalCandidates ||
    !isNonNegativeInteger(value.rowsUsed) ||
    !isNonNegativeInteger(value.quotaUnitsUsed) ||
    value.rowsUsed !== value.quotaUnitsUsed ||
    typeof value.creditsUsed !== "number" ||
    !Number.isFinite(value.creditsUsed) ||
    value.creditsUsed < 0 ||
    !isNonNegativeInteger(value.rawAssetCount) ||
    !isNonNegativeInteger(value.skippedAssetCount) ||
    !isNonNegativeInteger(value.providerTotal) ||
    !isIsoDate(value.startedAt) ||
    !isIsoDate(value.updatedAt) ||
    !isRecord(value.candidateProgress) ||
    !Array.isArray(value.assets) ||
    !value.assets.every(isValidMarketAssetCatalogItem)
  ) {
    return null;
  }

  const entries = Object.entries(value.candidateProgress);
  if (
    !entries.every(
      ([key, progress]) => isHash(key) && isCandidateCheckpoint(progress),
    )
  ) {
    return null;
  }
  const completedCount = entries.filter(([, progress]: any) => progress.completed)
    .length;
  const sum = (field: keyof MarketAssetsCandidateCheckpoint) =>
    entries.reduce((total, [, progress]: any) => total + progress[field], 0);
  const uniqueIds = new Set(value.assets.map((asset: any) => asset.assetId));

  if (
    completedCount !== value.candidatesVisited ||
    uniqueIds.size !== value.assets.length ||
    value.rawAssetCount !== value.assets.length + value.skippedAssetCount ||
    sum("rawAssetCount") !== value.rawAssetCount ||
    sum("skippedAssetCount") !== value.skippedAssetCount ||
    sum("validAssetCount") !== value.assets.length ||
    sum("quotaUnitsUsed") !== value.quotaUnitsUsed ||
    Math.abs(Number(sum("creditsUsed")) - value.creditsUsed) > 0.000001 ||
    sum("providerTotal") !== value.providerTotal
  ) {
    return null;
  }

  return value as MarketAssetsCollectionCheckpoint;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

async function recoverNewestBackup(filePath: string): Promise<boolean> {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
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
  await fs.rename(newest.candidatePath, filePath);
  return true;
}

async function deleteBackupArtifacts(filePath: string): Promise<void> {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(prefix) && name.endsWith(".bak"))
      .map((name) => fs.rm(path.join(directory, name), { force: true })),
  );
}

export class MarketAssetsCatalogStore implements IMarketAssetsCatalogStore {
  private memorySnapshot: MarketAssetsCatalogSnapshot | null = null;
  private memoryCheckpoint: MarketAssetsCollectionCheckpoint | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly catalogPath =
      process.env.MARKET_ASSETS_CATALOG_PATH ||
      "steamwebapi-json-data/market-assets-catalog.json",
    private readonly checkpointPath =
      process.env.MARKET_ASSETS_CHECKPOINT_PATH ||
      "steamwebapi-json-data/market-assets-checkpoint.json",
    private readonly defaultTarget = 10_000,
  ) {}

  get absolutePath(): string {
    return path.isAbsolute(this.catalogPath)
      ? this.catalogPath
      : path.resolve(process.cwd(), this.catalogPath);
  }

  get absoluteCheckpointPath(): string {
    return path.isAbsolute(this.checkpointPath)
      ? this.checkpointPath
      : path.resolve(process.cwd(), this.checkpointPath);
  }

  async readCatalog(): Promise<MarketAssetsCatalogSnapshot | null> {
    if (this.memorySnapshot) return cloneJson(this.memorySnapshot);
    try {
      const raw = await fs.readFile(this.absolutePath, "utf8");
      const parsed = parseMarketAssetsCatalogSnapshot(JSON.parse(raw));
      if (!parsed) {
        throw new Error(
          "El snapshot local de assets YouPin tiene un formato inválido.",
        );
      }
      this.memorySnapshot = parsed;
      return cloneJson(parsed);
    } catch (error) {
      if (isMissingFile(error)) {
        if (await recoverNewestBackup(this.absolutePath)) {
          return this.readCatalog();
        }
        return null;
      }
      throw error;
    }
  }

  async writeCatalog(snapshot: MarketAssetsCatalogSnapshot): Promise<void> {
    const validated = parseMarketAssetsCatalogSnapshot(snapshot);
    if (!validated) {
      throw new Error("No se puede escribir un snapshot de assets inválido.");
    }
    await this.enqueueWrite(this.absolutePath, validated);
    this.memorySnapshot = cloneJson(validated);
  }

  async readCheckpoint(): Promise<MarketAssetsCollectionCheckpoint | null> {
    if (this.memoryCheckpoint) return cloneJson(this.memoryCheckpoint);
    try {
      const raw = await fs.readFile(this.absoluteCheckpointPath, "utf8");
      const decoded = JSON.parse(raw);
      // Un checkpoint de otra versión se descarta de forma segura al reconstruir
      // la cola; un archivo corrupto de la versión actual sí detiene el proceso.
      if (
        isRecord(decoded) &&
        decoded.schemaVersion !== MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION &&
        decoded.schemaVersion !== 2 &&
        decoded.schemaVersion !== 3
      ) {
        return null;
      }
      const parsed = parseMarketAssetsCollectionCheckpoint(decoded);
      if (!parsed) {
        throw new Error(
          "El checkpoint de assets YouPin tiene un formato inválido.",
        );
      }
      this.memoryCheckpoint = parsed;
      return cloneJson(parsed);
    } catch (error) {
      if (isMissingFile(error)) {
        if (await recoverNewestBackup(this.absoluteCheckpointPath)) {
          return this.readCheckpoint();
        }
        return null;
      }
      throw error;
    }
  }

  async writeCheckpoint(
    checkpoint: MarketAssetsCollectionCheckpoint,
  ): Promise<void> {
    const validated = parseMarketAssetsCollectionCheckpoint(checkpoint);
    if (!validated) {
      throw new Error("No se puede escribir un checkpoint de assets inválido.");
    }
    await this.enqueueWrite(this.absoluteCheckpointPath, validated);
    this.memoryCheckpoint = cloneJson(validated);
  }

  async deleteCheckpoint(): Promise<void> {
    this.memoryCheckpoint = null;
    await fs.rm(this.absoluteCheckpointPath, { force: true });
    await deleteBackupArtifacts(this.absoluteCheckpointPath);
  }

  async getStatus(): Promise<MarketAssetsCatalogFileStatus> {
    const snapshot = await this.readCatalog();
    return {
      exists: Boolean(snapshot),
      path: this.absolutePath,
      version: snapshot?.version ?? null,
      fetchedAt: snapshot?.fetchedAt ?? null,
      requestedLimit: snapshot?.requestedLimit ?? this.defaultTarget,
      providerTotal: snapshot?.providerTotal ?? 0,
      rawAssetCount: snapshot?.rawAssetCount ?? 0,
      validAssetCount: snapshot?.validAssetCount ?? 0,
      skippedAssetCount: snapshot?.skippedAssetCount ?? 0,
      completionReason: snapshot?.completionReason ?? null,
    };
  }

  async getCheckpointStatus(): Promise<MarketAssetsCheckpointFileStatus> {
    const checkpoint = await this.readCheckpoint();
    return {
      exists: Boolean(checkpoint),
      path: this.absoluteCheckpointPath,
      queueVersion: checkpoint?.queueVersion ?? null,
      ...(checkpoint
        ? {
            concurrency: checkpoint.concurrency,
            initialConcurrency: checkpoint.initialConcurrency,
            effectiveConcurrency: checkpoint.effectiveConcurrency,
            circuitBreaker: cloneJson(checkpoint.circuitBreaker),
            targetDurationSeconds: checkpoint.targetDurationSeconds,
            targetDeadlineAt: checkpoint.targetDeadlineAt,
            tenMinuteTargetUnreachable:
              checkpoint.tenMinuteTargetUnreachable,
          }
        : {}),
      targetAssets: checkpoint?.targetAssets ?? this.defaultTarget,
      validAssetCount: checkpoint?.assets.length ?? 0,
      rawAssetCount: checkpoint?.rawAssetCount ?? 0,
      skippedAssetCount: checkpoint?.skippedAssetCount ?? 0,
      cursorIndex: checkpoint?.cursorIndex ?? 0,
      candidatesVisited: checkpoint?.candidatesVisited ?? 0,
      totalCandidates: checkpoint?.totalCandidates ?? 0,
      rowsUsed: checkpoint?.rowsUsed ?? 0,
      quotaUnitsUsed: checkpoint?.quotaUnitsUsed ?? 0,
      creditsUsed: checkpoint?.creditsUsed ?? 0,
      updatedAt: checkpoint?.updatedAt ?? null,
    };
  }

  clearMemoryCache(): void {
    this.memorySnapshot = null;
    this.memoryCheckpoint = null;
  }

  private enqueueWrite(filePath: string, value: unknown): Promise<void> {
    const write = this.writeChain.then(() => this.writeJsonAtomic(filePath, value));
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const suffix = `${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}`;
    const tempPath = `${filePath}.${suffix}.tmp`;
    const backupPath = `${filePath}.${suffix}.bak`;

    try {
      const handle = await fs.open(
        tempPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      try {
        await handle.writeFile(JSON.stringify(value), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }

      try {
        await fs.rename(tempPath, filePath);
      } catch (error) {
        const code = isRecord(error) ? String(error.code ?? "") : "";
        if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") {
          throw error;
        }

        let movedPrevious = false;
        try {
          await fs.rename(filePath, backupPath);
          movedPrevious = true;
        } catch (backupError) {
          if (!isMissingFile(backupError)) throw backupError;
        }
        try {
          await fs.rename(tempPath, filePath);
          if (movedPrevious) await fs.rm(backupPath, { force: true });
        } catch (replaceError) {
          if (movedPrevious) {
            await fs.rename(backupPath, filePath).catch(() => undefined);
          }
          throw replaceError;
        }
      }
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      // Si el rollback de Windows falló, la copia .bak es la última versión
      // recuperable y se conserva deliberadamente para intervención manual.
      throw error;
    }
  }
}
