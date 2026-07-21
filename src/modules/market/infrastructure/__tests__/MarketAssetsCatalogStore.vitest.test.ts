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
      queueVersion,
      targetAssets: 10_000,
      assetsPerItem: 10,
      sort: "newest",
      concurrency: 12,
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
          offset: 10,
          validAssetCount: 1,
          rawAssetCount: 2,
          skippedAssetCount: 1,
          quotaUnitsUsed: 10,
          creditsUsed: 1,
          providerTotal: 2,
          consecutiveFailures: 0,
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
