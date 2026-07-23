import { afterEach, describe, expect, it, vi } from "vitest";

const keys = [
  "ENABLE_SYNC",
  "ENABLE_ITEMS_CATALOG_SYNC",
  "MARKET_ASSETS_SYNC_INTERVAL_MINUTES",
  "FULL_CATALOG_SYNC_INTERVAL_MINUTES",
  "ITEMS_CATALOG_SYNC_INTERVAL_MINUTES",
  "STORE_SYNC_INTERVAL_MINUTES",
  "MARKET_ASSETS_CONCURRENCY",
  "MARKET_ASSETS_INITIAL_CONCURRENCY",
  "MARKET_ASSETS_TARGET_DURATION_SECONDS",
] as const;

const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

describe("sync scheduler config", () => {
  it("mantiene flags e intervalos de assets y catálogo local independientes", async () => {
    process.env.ENABLE_SYNC = "false";
    process.env.ENABLE_ITEMS_CATALOG_SYNC = "true";
    process.env.MARKET_ASSETS_SYNC_INTERVAL_MINUTES = "90";
    process.env.FULL_CATALOG_SYNC_INTERVAL_MINUTES = "180";
    process.env.ITEMS_CATALOG_SYNC_INTERVAL_MINUTES = "45";
    process.env.STORE_SYNC_INTERVAL_MINUTES = "30";
    process.env.MARKET_ASSETS_CONCURRENCY = "5";
    process.env.MARKET_ASSETS_INITIAL_CONCURRENCY = "9";
    process.env.MARKET_ASSETS_TARGET_DURATION_SECONDS = "120";
    vi.resetModules();

    const { config } = await import("../index");

    expect(config.enableSync).toBe(false);
    expect(config.enableItemsCatalogSync).toBe(true);
    expect(config.marketAssetsSync.intervalMinutes).toBe(90);
    expect(config.fullCatalogSync.intervalMinutes).toBe(90);
    expect(config.itemsCatalog.syncIntervalMinutes).toBe(45);
    expect(config.marketAssetsCatalog.concurrency).toBe(5);
    expect(config.marketAssetsCatalog.initialConcurrency).toBe(5);
    expect(config.marketAssetsCatalog.targetDurationSeconds).toBe(120);
  });

  it("acepta FULL_CATALOG como alias de assets y usa 300 ante intervalos inválidos", async () => {
    process.env.MARKET_ASSETS_SYNC_INTERVAL_MINUTES = "";
    process.env.FULL_CATALOG_SYNC_INTERVAL_MINUTES = "360";
    process.env.ITEMS_CATALOG_SYNC_INTERVAL_MINUTES = "0";
    delete process.env.STORE_SYNC_INTERVAL_MINUTES;
    process.env.MARKET_ASSETS_CONCURRENCY = "";
    process.env.MARKET_ASSETS_INITIAL_CONCURRENCY = "";
    process.env.MARKET_ASSETS_TARGET_DURATION_SECONDS = "";
    vi.resetModules();

    const { config } = await import("../index");

    expect(config.marketAssetsSync.intervalMinutes).toBe(360);
    expect(config.fullCatalogSync.intervalMinutes).toBe(360);
    expect(config.itemsCatalog.syncIntervalMinutes).toBe(300);
    expect(config.marketAssetsCatalog.concurrency).toBe(48);
    expect(config.marketAssetsCatalog.initialConcurrency).toBe(6);
    expect(config.marketAssetsCatalog.targetDurationSeconds).toBe(600);
  });

  it("limita el pool a 48 workers aunque el entorno solicite más", async () => {
    process.env.MARKET_ASSETS_CONCURRENCY = "500";
    process.env.MARKET_ASSETS_INITIAL_CONCURRENCY = "200";
    vi.resetModules();

    const { config } = await import("../index");

    expect(config.marketAssetsCatalog.concurrency).toBe(48);
    expect(config.marketAssetsCatalog.initialConcurrency).toBe(48);
  });
});
