import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarketAssetsCatalogSnapshotBuilder } from "../../application/MarketAssetsCatalogSnapshotBuilder";
import { marketAsset } from "../../application/__tests__/marketAssetsTestHelpers";
import {
  MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION,
  type MarketAssetsCollectionCheckpoint,
} from "../../domain/MarketAssetsCatalog";
import { MarketAssetsCatalogStore } from "../MarketAssetsCatalogStore";

describe("MarketAssetsCatalogStore", () => {
  let tempDirectory: string;
  let catalogPath: string;
  let checkpointPath: string;

  beforeEach(async () => {
    tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "jabbu-market-assets-store-"),
    );
    catalogPath = path.join(tempDirectory, "market-assets.json");
    checkpointPath = path.join(tempDirectory, "market-assets.pending.json");
  });

  afterEach(async () => {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  function snapshot(assetId: string) {
    const assets = [marketAsset(assetId)];
    return new MarketAssetsCatalogSnapshotBuilder().buildNormalized({
      assets,
      providerTotal: 1,
      requestedLimit: 10_000,
      rawAssetCount: 1,
      skippedAssetCount: 0,
      sort: "newest",
      sourceUrl: "https://example.test/float/assets?limit=10&sort=newest",
      completionReason: "catalog_exhausted",
      fetchedAt: "2026-07-20T00:00:00.000Z",
    });
  }

  function checkpoint(): MarketAssetsCollectionCheckpoint {
    const asset = marketAsset("checkpoint-asset");
    const candidateKey = createHash("sha256")
      .update("candidate")
      .digest("hex");
    const queueVersion = createHash("sha256").update("queue").digest("hex");
    return {
      schemaVersion: MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION,
      runId: "run-checkpoint",
      queueVersion,
      targetAssets: 10_000,
      assetsPerItem: 10,
      sort: "newest",
      concurrency: 48,
      initialConcurrency: 6,
      effectiveConcurrency: 3,
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
      targetDurationSeconds: 600,
      targetDeadlineAt: "2026-07-20T00:10:00.000Z",
      tenMinuteTargetUnreachable: false,
      successfulBatchesSinceReduction: 4,
      adaptiveFailureRounds: 0,
      cursorIndex: 1,
      candidatesVisited: 1,
      totalCandidates: 1,
      rowsUsed: 10,
      quotaUnitsUsed: 10,
      creditsUsed: 1,
      rawAssetCount: 2,
      skippedAssetCount: 1,
      providerTotal: 2,
      startedAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:01:00.000Z",
      candidateProgress: {
        [candidateKey]: {
          initialLimit: 10,
          offset: 10,
          validAssetCount: 1,
          rawAssetCount: 2,
          skippedAssetCount: 1,
          quotaUnitsUsed: 10,
          creditsUsed: 1,
          providerTotal: 2,
          consecutiveFailures: 0,
          pageRequests: 1,
          httpAttempts: 1,
          deferredRecoveryAttempts: 0,
          completed: true,
          exhausted: true,
          lastError: null,
        },
      },
      assets: [asset],
    };
  }

  it("serializa escrituras y deja siempre un snapshot completo sin temporales", async () => {
    const store = new MarketAssetsCatalogStore(catalogPath, checkpointPath);
    const first = snapshot("first");
    const second = snapshot("second");
    const third = snapshot("third");

    await Promise.all([
      store.writeCatalog(first),
      store.writeCatalog(second),
      store.writeCatalog(third),
    ]);

    const restartedStore = new MarketAssetsCatalogStore(
      catalogPath,
      checkpointPath,
    );
    expect(await restartedStore.readCatalog()).toEqual(third);
    expect(JSON.parse(await fs.readFile(catalogPath, "utf8"))).toEqual(third);
    expect(await fs.readdir(tempDirectory)).toEqual(["market-assets.json"]);
  });

  it("rechaza un snapshot inválido sin reemplazar el último válido", async () => {
    const store = new MarketAssetsCatalogStore(catalogPath, checkpointPath);
    const valid = snapshot("safe");
    await store.writeCatalog(valid);

    await expect(
      store.writeCatalog({
        ...snapshot("unsafe"),
        sourceUrl: "https://example.test/float/assets?key=secret",
      }),
    ).rejects.toThrow("snapshot de assets inválido");

    const restartedStore = new MarketAssetsCatalogStore(
      catalogPath,
      checkpointPath,
    );
    expect(await restartedStore.readCatalog()).toEqual(valid);
    expect(await fs.readdir(tempDirectory)).toEqual(["market-assets.json"]);
  });

  it("persiste, valida y elimina checkpoints sin corromper el anterior", async () => {
    const store = new MarketAssetsCatalogStore(catalogPath, checkpointPath);
    const valid = checkpoint();
    await store.writeCheckpoint(valid);
    expect(await store.getCheckpointStatus()).toMatchObject({
      exists: true,
      concurrency: 48,
      initialConcurrency: 6,
      effectiveConcurrency: 3,
      circuitBreaker: {
        state: "closed",
        openCount: 0,
        resumeAt: null,
      },
      targetDurationSeconds: 600,
      targetDeadlineAt: "2026-07-20T00:10:00.000Z",
      tenMinuteTargetUnreachable: false,
    });

    const invalid: MarketAssetsCollectionCheckpoint = {
      ...valid,
      rawAssetCount: 999,
    };
    await expect(store.writeCheckpoint(invalid)).rejects.toThrow(
      "checkpoint de assets inválido",
    );

    const restartedStore = new MarketAssetsCatalogStore(
      catalogPath,
      checkpointPath,
    );
    expect(await restartedStore.readCheckpoint()).toEqual(valid);
    expect(await fs.readdir(tempDirectory)).toEqual([
      "market-assets.pending.json",
    ]);

    await restartedStore.deleteCheckpoint();
    expect(await restartedStore.readCheckpoint()).toBeNull();
    await expect(fs.stat(checkpointPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("migra checkpoints v2 a v4 sin perder assets ni offsets", async () => {
    const legacy: any = structuredClone(checkpoint());
    legacy.schemaVersion = 2;
    delete legacy.runId;
    delete legacy.initialConcurrency;
    delete legacy.effectiveConcurrency;
    delete legacy.rampStage;
    delete legacy.latencyBaselineMs;
    delete legacy.recentHealthSamples;
    delete legacy.concurrencyCooldownUntil;
    delete legacy.consecutiveCongestionFailures;
    delete legacy.circuitBreaker;
    delete legacy.targetDurationSeconds;
    delete legacy.targetDeadlineAt;
    delete legacy.tenMinuteTargetUnreachable;
    delete legacy.successfulBatchesSinceReduction;
    delete legacy.adaptiveFailureRounds;
    for (const progress of Object.values<any>(legacy.candidateProgress)) {
      delete progress.initialLimit;
      delete progress.pageRequests;
      delete progress.httpAttempts;
      delete progress.deferredRecoveryAttempts;
    }
    await fs.writeFile(checkpointPath, JSON.stringify(legacy), "utf8");

    const migrated = await new MarketAssetsCatalogStore(
      catalogPath,
      checkpointPath,
    ).readCheckpoint();

    expect(migrated).toMatchObject({
      schemaVersion: 4,
      runId: null,
      initialConcurrency: 6,
      effectiveConcurrency: 3,
      rampStage: 0,
      recentHealthSamples: [],
      circuitBreaker: {
        state: "closed",
        openCount: 0,
        resumeAt: null,
      },
      cursorIndex: 1,
      assets: [expect.objectContaining({ assetId: "checkpoint-asset" })],
    });
    expect(Object.values(migrated!.candidateProgress)[0]).toMatchObject({
      initialLimit: 0,
      offset: 10,
      pageRequests: 0,
      httpAttempts: 0,
      deferredRecoveryAttempts: 0,
      validAssetCount: 1,
    });
  });

  it("migra checkpoints v3 a v4 preservando runId, assets y offsets", async () => {
    const legacy: any = structuredClone(checkpoint());
    legacy.schemaVersion = 3;
    legacy.concurrency = 12;
    legacy.effectiveConcurrency = 2;
    delete legacy.initialConcurrency;
    delete legacy.rampStage;
    delete legacy.latencyBaselineMs;
    delete legacy.recentHealthSamples;
    delete legacy.concurrencyCooldownUntil;
    delete legacy.consecutiveCongestionFailures;
    delete legacy.circuitBreaker;
    delete legacy.targetDurationSeconds;
    delete legacy.targetDeadlineAt;
    delete legacy.tenMinuteTargetUnreachable;
    await fs.writeFile(checkpointPath, JSON.stringify(legacy), "utf8");

    const migrated = await new MarketAssetsCatalogStore(
      catalogPath,
      checkpointPath,
    ).readCheckpoint();

    expect(migrated).toMatchObject({
      schemaVersion: 4,
      runId: "run-checkpoint",
      concurrency: 12,
      initialConcurrency: 6,
      effectiveConcurrency: 2,
      targetDurationSeconds: 600,
      targetDeadlineAt: "2026-07-20T00:10:00.000Z",
      cursorIndex: 1,
      assets: [expect.objectContaining({ assetId: "checkpoint-asset" })],
    });
    expect(Object.values(migrated!.candidateProgress)[0]).toMatchObject({
      offset: 10,
      validAssetCount: 1,
    });
  });

  it("rechaza checkpoints que exceden 48 workers o la ventana de salud", async () => {
    const store = new MarketAssetsCatalogStore(catalogPath, checkpointPath);
    const tooManyWorkers = { ...checkpoint(), concurrency: 49 };
    await expect(
      store.writeCheckpoint(tooManyWorkers as MarketAssetsCollectionCheckpoint),
    ).rejects.toThrow("checkpoint de assets inválido");

    const oversizedHealthWindow = checkpoint();
    oversizedHealthWindow.recentHealthSamples = Array.from(
      { length: 101 },
      () => ({
        recordedAt: "2026-07-20T00:01:00.000Z",
        latencyMs: 100,
        assetsCollected: 10,
        outcome: "success" as const,
      }),
    );
    await expect(
      store.writeCheckpoint(oversizedHealthWindow),
    ).rejects.toThrow("checkpoint de assets inválido");
  });

  it("recupera snapshot y checkpoint si Windows dejó sólo el backup", async () => {
    const store = new MarketAssetsCatalogStore(catalogPath, checkpointPath);
    const validSnapshot = snapshot("recoverable");
    const validCheckpoint = checkpoint();
    await store.writeCatalog(validSnapshot);
    await store.writeCheckpoint(validCheckpoint);
    await fs.rename(catalogPath, `${catalogPath}.crash.bak`);
    await fs.rename(checkpointPath, `${checkpointPath}.crash.bak`);

    const restartedStore = new MarketAssetsCatalogStore(
      catalogPath,
      checkpointPath,
    );
    expect(await restartedStore.readCatalog()).toEqual(validSnapshot);
    expect(await restartedStore.readCheckpoint()).toEqual(validCheckpoint);
    expect(await fs.readdir(tempDirectory)).toEqual([
      "market-assets.json",
      "market-assets.pending.json",
    ]);
  });
});
