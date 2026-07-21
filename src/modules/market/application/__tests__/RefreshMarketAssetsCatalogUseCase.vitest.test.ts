import { describe, expect, it, vi } from "vitest";
import { RefreshMarketAssetsCatalogUseCase } from "../RefreshMarketAssetsCatalogUseCase";

function snapshot() {
  return {
    schemaVersion: 1 as const,
    version: "a".repeat(64),
    fetchedAt: new Date(0).toISOString(),
    source: "youpin" as const,
    sourceUrl: "https://example.test/float/assets",
    sort: "newest" as const,
    requestedLimit: 10_000,
    providerTotal: 1,
    rawAssetCount: 1,
    validAssetCount: 1,
    skippedAssetCount: 0,
    completionReason: "catalog_exhausted" as const,
    assets: [{ listingName: "AK-47 | Redline (Field-Tested)" }],
  };
}

describe("RefreshMarketAssetsCatalogUseCase recovery", () => {
  it("publica un archivo descargado aunque el crash ocurrió antes de guardar su estado", async () => {
    const downloaded = snapshot();
    const store = {
      getCheckpointStatus: vi.fn(async () => ({ exists: false })),
      readCatalog: vi.fn(async () => downloaded),
      deleteCheckpoint: vi.fn(async () => undefined),
    };
    const state = {
      get: vi.fn(async () => ({
        lastPublishedSnapshotHash: "b".repeat(64),
        currentPhase: "failed",
      })),
      markPublished: vi.fn(async () => undefined),
    };
    const publisher = {
      publish: vi.fn(async () => ({ listings: 1, floats: 1 })),
    };
    const collector = { execute: vi.fn() };
    const useCase = new RefreshMarketAssetsCatalogUseCase(
      collector as any,
      store as any,
      publisher as any,
      state as any,
    );

    const result = await useCase.recoverPending();

    expect(result?.recoveredSnapshot).toBe(true);
    expect(publisher.publish).toHaveBeenCalledWith(downloaded);
    expect(collector.execute).not.toHaveBeenCalled();
    expect(state.markPublished).toHaveBeenCalledOnce();
  });

  it("limpia un checkpoint residual cuando la DB ya había sido publicada", async () => {
    const store = {
      getCheckpointStatus: vi.fn(async () => ({ exists: true })),
      readCatalog: vi.fn(async () => snapshot()),
      deleteCheckpoint: vi.fn(async () => undefined),
    };
    const state = {
      get: vi.fn(async () => ({
        currentPhase: "publishing_database",
        lastPublishedSnapshotHash: "a".repeat(64),
        lastPublishedListingCount: 1,
        lastPublishedFloatCount: 1,
        lastPublishedRawAssetCount: 1,
        lastPublishedValidAssetCount: 1,
        lastPublishedSkippedAssetCount: 0,
        lastPublishedAt: new Date(0),
        completionReason: "catalog_exhausted",
      })),
    };
    const useCase = new RefreshMarketAssetsCatalogUseCase(
      { execute: vi.fn() } as any,
      store as any,
      { publish: vi.fn() } as any,
      state as any,
    );

    const result = await useCase.recoverPending();

    expect(result?.floats).toBe(1);
    expect(store.deleteCheckpoint).toHaveBeenCalledOnce();
  });

  it("no reutiliza el snapshot anterior después de una corrida ya completada", async () => {
    const store = {
      getCheckpointStatus: vi.fn(async () => ({ exists: false })),
      readCatalog: vi.fn(async () => snapshot()),
    };
    const state = {
      get: vi.fn(async () => ({
        currentPhase: "completed",
        queueVersion: "a".repeat(64),
        lastPublishedSnapshotHash: "a".repeat(64),
      })),
    };
    const collector = { execute: vi.fn() };
    const useCase = new RefreshMarketAssetsCatalogUseCase(
      collector as any,
      store as any,
      { publish: vi.fn() } as any,
      state as any,
    );

    await expect(useCase.recoverPending()).resolves.toBeNull();
    expect(collector.execute).not.toHaveBeenCalled();
  });

  it("no convierte en éxito una corrida nueva fallida que conserva queueVersion", async () => {
    const store = {
      getCheckpointStatus: vi.fn(async () => ({ exists: false })),
      readCatalog: vi.fn(async () => snapshot()),
      deleteCheckpoint: vi.fn(),
    };
    const state = {
      get: vi.fn(async () => ({
        currentPhase: "failed",
        queueVersion: "a".repeat(64),
        lastPublishedSnapshotHash: "a".repeat(64),
        lastPublishedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastStartedAt: new Date("2026-01-02T00:00:00.000Z"),
      })),
    };
    const useCase = new RefreshMarketAssetsCatalogUseCase(
      { execute: vi.fn() } as any,
      store as any,
      { publish: vi.fn() } as any,
      state as any,
    );

    await expect(useCase.recoverPending()).resolves.toBeNull();
    expect(store.deleteCheckpoint).not.toHaveBeenCalled();
  });
});
