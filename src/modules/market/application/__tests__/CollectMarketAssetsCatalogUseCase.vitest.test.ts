import { describe, expect, it, vi } from "vitest";
import { CollectMarketAssetsCatalogUseCase } from "../CollectMarketAssetsCatalogUseCase";
import {
  MarketAssetsApiError,
  type IMarketAssetsCatalogClient,
  type MarketAssetsCandidatePage,
  type MarketAssetsPageRequest,
} from "../IMarketAssetsCatalogClient";
import type { MarketAssetsPriorityCandidate } from "../MarketAssetsPriorityQueue";
import type { IMarketAssetCandidateHistoryRepository } from "../../domain/IMarketAssetCandidateHistoryRepository";
import {
  MemoryMarketAssetsCatalogStore,
  priorityQueue,
  rawMarketAsset,
  syncStateRepository,
} from "./marketAssetsTestHelpers";

function page(
  assets: unknown[],
  request: MarketAssetsPageRequest,
  providerTotal: number,
): MarketAssetsCandidatePage {
  return {
    assets,
    providerTotal,
    limit: request.limit,
    offset: request.offset,
    quotaUnitsUsed: request.limit,
    rowsUsed: request.limit,
    creditsUsed: request.limit / 10,
    httpAttempts: 1,
    durationMs: 5,
    outcome: assets.length > 0 ? "success" : "success_empty",
  };
}

function client(
  fetchCandidatePage: IMarketAssetsCatalogClient["fetchCandidatePage"],
): IMarketAssetsCatalogClient {
  return {
    getSafeSourceUrl: ({ limit, sort }) =>
      `https://example.test/float/assets?limit=${limit}&sort=${sort}`,
    fetchCandidatePage,
  };
}

const redline = {
  markethashname: "AK-47 | Redline (Field-Tested)",
  itemgroup: "rifle",
  pricereal: 300,
};

describe("CollectMarketAssetsCatalogUseCase", () => {
  it("pagina hasta reunir diez válidos y cuenta inválidos, cuota y créditos", async () => {
    const store = new MemoryMarketAssetsCatalogStore();
    const calls: Array<{ limit: number; offset: number }> = [];
    const api = client(async (_candidate, request) => {
      calls.push({ limit: request.limit, offset: request.offset });
      if (request.offset === 0) {
        return page(
          [
            ...Array.from({ length: 5 }, (_, index) =>
              rawMarketAsset(redline.markethashname, `valid-${index}`),
            ),
            ...Array.from({ length: 5 }, (_, index) =>
              rawMarketAsset(redline.markethashname, `invalid-${index}`, {
                price: 0,
              }),
            ),
          ],
          request,
          15,
        );
      }
      return page(
        Array.from({ length: 5 }, (_, index) =>
          rawMarketAsset(redline.markethashname, `valid-${index + 5}`),
        ),
        request,
        15,
      );
    });
    const collector = new CollectMarketAssetsCatalogUseCase(
      api,
      priorityQueue([redline]),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 10, assetsPerItem: 10, concurrency: 1 },
    );

    const result = await collector.execute("test-assets");

    expect(calls).toEqual([
      { limit: 10, offset: 0 },
      { limit: 5, offset: 10 },
    ]);
    expect(result).toMatchObject({
      completionReason: "target_reached",
      resumedCheckpoint: false,
    });
    expect(result.snapshot).toMatchObject({
      requestedLimit: 10,
      rawAssetCount: 15,
      validAssetCount: 10,
      skippedAssetCount: 5,
      completionReason: "target_reached",
    });
    expect(new Set(result.snapshot.assets.map((asset) => asset.assetId)).size)
      .toBe(10);
    expect(store.checkpoint).toMatchObject({
      quotaUnitsUsed: 15,
      rowsUsed: 15,
      creditsUsed: 1.5,
      rawAssetCount: 15,
      skippedAssetCount: 5,
      cursorIndex: 1,
    });
  });

  it("respeta el máximo por listing y recorta exactamente al objetivo global", async () => {
    const catalog = [
      redline,
      {
        markethashname: "AWP | Asiimov (Field-Tested)",
        itemgroup: "sniper rifle",
        pricereal: 200,
      },
      {
        markethashname: "M4A4 | The Emperor (Factory New)",
        itemgroup: "rifle",
        pricereal: 100,
      },
    ];
    const store = new MemoryMarketAssetsCatalogStore();
    const api = client(async (candidate, request) =>
      page(
        Array.from({ length: request.limit }, (_, index) =>
          rawMarketAsset(
            candidate.marketHashName,
            `${candidate.key}-${request.offset + index}`,
          ),
        ),
        request,
        100,
      ),
    );
    const collector = new CollectMarketAssetsCatalogUseCase(
      api,
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 12, assetsPerItem: 5, concurrency: 2 },
    );

    const { snapshot } = await collector.execute("test-target");
    const perListing = new Map<string, typeof snapshot.assets>();
    for (const asset of snapshot.assets) {
      const group = perListing.get(asset.listingName) ?? [];
      group.push(asset);
      perListing.set(asset.listingName, group);
    }

    expect(snapshot.validAssetCount).toBe(12);
    expect(snapshot.rawAssetCount).toBe(15);
    expect(snapshot.skippedAssetCount).toBe(3);
    expect(snapshot.completionReason).toBe("target_reached");
    expect([...perListing.values()].map((assets) => assets.length)).toEqual([
      5, 5, 2,
    ]);
    expect(snapshot.assets.map((asset) => asset.listingName)).toEqual([
      ...Array(5).fill(catalog[0]!.markethashname),
      ...Array(5).fill(catalog[1]!.markethashname),
      ...Array(2).fill(catalog[2]!.markethashname),
    ]);
  });

  it(
    "reúne exactamente 10.000 assets sintéticos, diez por listing y sin duplicados",
    async () => {
      const listingCount = 1_000;
      const catalog = Array.from({ length: listingCount }, (_, index) => ({
        markethashname: `AK-47 | Synthetic ${String(index).padStart(4, "0")} (Factory New)`,
        itemgroup: "rifle",
        pricereal: listingCount - index,
      }));
      const store = new MemoryMarketAssetsCatalogStore();
      const apiCall = vi.fn(async (candidate, request) =>
        page(
          Array.from({ length: request.limit }, (_, index) =>
            rawMarketAsset(
              candidate.marketHashName,
              `${candidate.key}-${request.offset + index}`,
            ),
          ),
          request,
          10,
        ),
      );
      const collector = new CollectMarketAssetsCatalogUseCase(
        client(apiCall),
        priorityQueue(catalog),
        store,
        syncStateRepository(),
        undefined,
        { targetAssets: 10_000, assetsPerItem: 10, concurrency: 3 },
      );

      const { snapshot } = await collector.execute("test-exact-10000");
      const counts = new Map<string, number>();
      for (const asset of snapshot.assets) {
        counts.set(asset.listingName, (counts.get(asset.listingName) ?? 0) + 1);
      }

      expect(snapshot).toMatchObject({
        requestedLimit: 10_000,
        rawAssetCount: 10_000,
        validAssetCount: 10_000,
        skippedAssetCount: 0,
        completionReason: "target_reached",
      });
      expect(apiCall).toHaveBeenCalledTimes(listingCount);
      expect(counts.size).toBe(listingCount);
      expect(new Set(counts.values())).toEqual(new Set([10]));
      expect(new Set(snapshot.assets.map((asset) => asset.assetId)).size).toBe(
        10_000,
      );
    },
    20_000,
  );

  it("publica un snapshot vacío cuando agotó de verdad todo el catálogo", async () => {
    const store = new MemoryMarketAssetsCatalogStore();
    const apiCall = vi.fn(async (_candidate, request) =>
      page([], request, 0),
    );
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue([redline]),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 10, assetsPerItem: 10, concurrency: 1 },
    );

    const { snapshot, completionReason } = await collector.execute(
      "test-empty-catalog",
    );

    expect(completionReason).toBe("catalog_exhausted");
    expect(snapshot).toMatchObject({
      requestedLimit: 10,
      rawAssetCount: 0,
      validAssetCount: 0,
      skippedAssetCount: 0,
      completionReason: "catalog_exhausted",
      assets: [],
    });
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("agota el catálogo sin duplicar un asset compartido entre listings", async () => {
    const catalog = [
      redline,
      {
        markethashname: "AWP | Asiimov (Field-Tested)",
        itemgroup: "sniper rifle",
        pricereal: 200,
      },
    ];
    const store = new MemoryMarketAssetsCatalogStore();
    const api = client(async (candidate, request) =>
      page(
        [
          rawMarketAsset(candidate.marketHashName, "shared-asset"),
          rawMarketAsset(
            candidate.marketHashName,
            candidate.marketHashName.startsWith("AK")
              ? "redline-only"
              : "asiimov-only",
          ),
        ],
        request,
        2,
      ),
    );
    const collector = new CollectMarketAssetsCatalogUseCase(
      api,
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 10, assetsPerItem: 3, concurrency: 1 },
    );

    const result = await collector.execute("test-exhausted");

    expect(result.completionReason).toBe("catalog_exhausted");
    expect(result.snapshot).toMatchObject({
      rawAssetCount: 4,
      validAssetCount: 3,
      skippedAssetCount: 1,
      completionReason: "catalog_exhausted",
    });
    expect(result.snapshot.assets.map((asset) => asset.assetId)).toEqual([
      "shared-asset",
      "redline-only",
      "asiimov-only",
    ]);
  });

  it("persiste el avance antes de abortar un 402 fatal y reanuda sin repetir skins completas", async () => {
    const catalog = [
      redline,
      {
        markethashname: "AWP | Asiimov (Field-Tested)",
        itemgroup: "sniper rifle",
        pricereal: 200,
      },
      {
        markethashname: "M4A4 | The Emperor (Factory New)",
        itemgroup: "rifle",
        pricereal: 100,
      },
    ];
    const store = new MemoryMarketAssetsCatalogStore();
    const firstRunCalls: string[] = [];
    const firstApi = client(async (candidate, request) => {
      firstRunCalls.push(candidate.marketHashName);
      if (candidate.marketHashName.startsWith("AWP")) {
        throw new MarketAssetsApiError(
          "HTTP 402: quota agotada",
          "fatal",
          402,
          request.limit,
        );
      }
      return page(
        [rawMarketAsset(candidate.marketHashName, `first-${candidate.key}`)],
        request,
        1,
      );
    });
    const firstCollector = new CollectMarketAssetsCatalogUseCase(
      firstApi,
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 2, assetsPerItem: 1, concurrency: 1 },
    );

    await expect(firstCollector.execute("test-resume")).rejects.toMatchObject({
      status: 402,
      kind: "fatal",
    });
    expect(firstRunCalls).toEqual([
      "AK-47 | Redline (Field-Tested)",
      "AWP | Asiimov (Field-Tested)",
    ]);
    expect(store.checkpoint).toMatchObject({
      cursorIndex: 1,
      candidatesVisited: 1,
      quotaUnitsUsed: 2,
    });
    expect(store.checkpoint?.assets).toHaveLength(1);

    const resumedCalls: string[] = [];
    const resumedApi = client(async (candidate, request) => {
      resumedCalls.push(candidate.marketHashName);
      return page(
        [rawMarketAsset(candidate.marketHashName, `resumed-${candidate.key}`)],
        request,
        1,
      );
    });
    const resumedCollector = new CollectMarketAssetsCatalogUseCase(
      resumedApi,
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 2, assetsPerItem: 1, concurrency: 1 },
    );

    const result = await resumedCollector.execute("test-resume");

    expect(result.resumedCheckpoint).toBe(true);
    expect(result.snapshot.validAssetCount).toBe(2);
    expect(result.snapshot.completionReason).toBe("target_reached");
    expect(resumedCalls).toEqual(["AWP | Asiimov (Field-Tested)"]);
    expect(resumedCalls).not.toContain("AK-47 | Redline (Field-Tested)");
  });

  it("checkpointa un 429, limita sus reintentos y reanuda en otra ejecución", async () => {
    const store = new MemoryMarketAssetsCatalogStore();
    const rateLimitedCall = vi.fn(
      async (
        _candidate: MarketAssetsPriorityCandidate,
        request: MarketAssetsPageRequest,
      ) => {
        throw new MarketAssetsApiError(
          "HTTP 429: cuota agotada",
          "retryable",
          429,
          request.limit,
        );
      },
    );
    const options = {
      targetAssets: 10,
      assetsPerItem: 10,
      concurrency: 1,
    };
    const interrupted = new CollectMarketAssetsCatalogUseCase(
      client(rateLimitedCall),
      priorityQueue([redline]),
      store,
      syncStateRepository(),
      undefined,
      options,
    );

    await expect(interrupted.execute("test-429")).rejects.toMatchObject({
      status: 429,
      kind: "retryable",
    });
    expect(rateLimitedCall).toHaveBeenCalledTimes(3);
    expect(store.checkpoint).toMatchObject({ quotaUnitsUsed: 30 });
    expect(
      Object.values(store.checkpoint?.candidateProgress ?? {})[0],
    ).toMatchObject({
      consecutiveFailures: 3,
      offset: 0,
      completed: false,
    });

    const recoveredCall = vi.fn(
      async (
        candidate: MarketAssetsPriorityCandidate,
        request: MarketAssetsPageRequest,
      ) =>
        page(
          Array.from({ length: 10 }, (_, index) =>
            rawMarketAsset(candidate.marketHashName, `recovered-${index}`),
          ),
          request,
          10,
        ),
    );
    const recovered = new CollectMarketAssetsCatalogUseCase(
      client(recoveredCall),
      priorityQueue([redline]),
      store,
      syncStateRepository(),
      undefined,
      options,
    );

    const result = await recovered.execute("test-429");

    expect(result.resumedCheckpoint).toBe(true);
    expect(result.snapshot.validAssetCount).toBe(10);
    expect(recoveredCall).toHaveBeenCalledTimes(1);
    expect(store.checkpoint).toMatchObject({ quotaUnitsUsed: 40 });
  });

  it("difiere un timeout aislado, continúa y recupera la prioridad antes de publicar", async () => {
    const catalog = [
      redline,
      {
        markethashname: "AWP | Asiimov (Field-Tested)",
        itemgroup: "sniper rifle",
        pricereal: 200,
      },
      {
        markethashname: "M4A4 | The Emperor (Factory New)",
        itemgroup: "rifle",
        pricereal: 100,
      },
    ];
    const store = new MemoryMarketAssetsCatalogStore();
    let redlineCalls = 0;
    const apiCall = vi.fn(async (candidate, request) => {
      if (
        candidate.marketHashName.startsWith("AK-47") &&
        redlineCalls++ === 0
      ) {
        throw new MarketAssetsApiError(
          "timeout agotado",
          "retryable",
          0,
          request.limit * 3,
        );
      }
      return page(
        [rawMarketAsset(candidate.marketHashName, `asset-${candidate.key}`)],
        request,
        1,
      );
    });
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 2, assetsPerItem: 1, concurrency: 2 },
      { sleep: vi.fn(async () => undefined) },
    );

    const result = await collector.execute("test-deferred-timeout");

    expect(result.snapshot.validAssetCount).toBe(2);
    expect(result.snapshot.completionReason).toBe("target_reached");
    expect(result.snapshot.assets.map((asset) => asset.listingName)).toEqual([
      catalog[0]!.markethashname,
      catalog[1]!.markethashname,
    ]);
    const recovered = Object.values(
      store.checkpoint?.candidateProgress ?? {},
    ).find((progress) => progress.validAssetCount === 1);
    expect(recovered).toMatchObject({
      completed: true,
      consecutiveFailures: 0,
      deferredRecoveryAttempts: 0,
      lastError: null,
    });
  });

  it("reduce la concurrencia y aborta sólo cuando también falla el probe serial", async () => {
    const catalog = [
      redline,
      {
        markethashname: "AWP | Asiimov (Field-Tested)",
        itemgroup: "sniper rifle",
        pricereal: 200,
      },
    ];
    const store = new MemoryMarketAssetsCatalogStore();
    const apiCall = vi.fn(async (_candidate, request) => {
      throw new MarketAssetsApiError(
        "proveedor sin respuesta",
        "retryable",
        0,
        request.limit * 3,
      );
    });
    const sleep = vi.fn(async () => undefined);
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 2, assetsPerItem: 1, concurrency: 2 },
      { sleep },
    );

    await expect(collector.execute("test-global-timeout")).rejects.toMatchObject({
      kind: "retryable",
      status: 0,
    });
    expect(apiCall).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1_000, 2_000]);
    expect(
      Object.values(store.checkpoint?.candidateProgress ?? {}).every(
        (progress) => !progress.completed,
      ),
    ).toBe(true);
  });

  it("no reduce AIMD por un timeout aislado en un lote de tres", async () => {
    const catalog = [
      redline,
      {
        markethashname: "AWP | Asiimov (Field-Tested)",
        itemgroup: "sniper rifle",
        pricereal: 200,
      },
      {
        markethashname: "M4A4 | The Emperor (Factory New)",
        itemgroup: "rifle",
        pricereal: 100,
      },
      {
        markethashname: "USP-S | Printstream (Factory New)",
        itemgroup: "pistol",
        pricereal: 50,
      },
    ];
    let redlineCalls = 0;
    const progressSpy = vi.fn(async () => undefined);
    const state = syncStateRepository();
    state.markCollectionProgress = progressSpy;
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(async (candidate, request) => {
        if (
          candidate.marketHashName === redline.markethashname &&
          redlineCalls++ === 0
        ) {
          throw new MarketAssetsApiError(
            "timeout aislado",
            "retryable",
            0,
            request.limit,
            0,
            1,
            25,
            "timeout",
          );
        }
        return page(
          [rawMarketAsset(candidate.marketHashName, `ok-${candidate.key}`)],
          request,
          1,
        );
      }),
      priorityQueue(catalog),
      new MemoryMarketAssetsCatalogStore(),
      state,
      undefined,
      { targetAssets: 3, assetsPerItem: 1, concurrency: 3 },
      { sleep: vi.fn(async () => undefined) },
    );

    const result = await collector.execute("test-isolated-aimd");

    expect(result.snapshot.validAssetCount).toBe(3);
    expect(progressSpy.mock.calls[0]![2].telemetry).toMatchObject({
      currentConcurrency: 3,
      concurrencyReductionCount: 0,
      timeoutCount: 1,
    });
  });

  it("reduce AIMD cuando fallan por congestión los tres requests del lote", async () => {
    const catalog = Array.from({ length: 3 }, (_, index) => ({
      markethashname: `AK-47 | Congestion ${index} (Factory New)`,
      itemgroup: "rifle",
      pricereal: 100 - index,
    }));
    let calls = 0;
    const progressSpy = vi.fn(async () => undefined);
    const state = syncStateRepository();
    state.markCollectionProgress = progressSpy;
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(async (candidate, request) => {
        if (++calls <= 3) {
          throw new MarketAssetsApiError(
            "lote congestionado",
            "retryable",
            0,
            request.limit,
            0,
            1,
            30,
            "timeout",
          );
        }
        return page(
          [rawMarketAsset(candidate.marketHashName, `ok-${candidate.key}`)],
          request,
          1,
        );
      }),
      priorityQueue(catalog),
      new MemoryMarketAssetsCatalogStore(),
      state,
      undefined,
      { targetAssets: 3, assetsPerItem: 1, concurrency: 3 },
      { sleep: vi.fn(async () => undefined) },
    );

    await expect(collector.execute("test-full-batch-aimd")).resolves.toMatchObject({
      completionReason: "target_reached",
    });
    expect(progressSpy.mock.calls[0]![2].telemetry).toMatchObject({
      currentConcurrency: 1,
      concurrencyReductionCount: 1,
      timeoutCount: 3,
    });
  });

  it("degrada 3 a 1 y sube a 2 tras quince lotes sanos", async () => {
    const catalog = Array.from({ length: 18 }, (_, index) => ({
      markethashname: `AK-47 | Adaptive ${String(index).padStart(2, "0")} (Factory New)`,
      itemgroup: "rifle",
      pricereal: 1_000 - index,
    }));
    const store = new MemoryMarketAssetsCatalogStore();
    let calls = 0;
    const apiCall = vi.fn(async (candidate, request) => {
      calls++;
      // El primer lote físico queda limitado a tres. Desde el probe serial la
      // API se recupera y AIMD suma uno después de quince lotes saludables.
      if (calls <= 3) {
        throw new MarketAssetsApiError(
          "concurrencia saturada",
          "retryable",
          0,
          request.limit * 3,
        );
      }
      return page(
        [rawMarketAsset(candidate.marketHashName, `asset-${candidate.key}`)],
        request,
        1,
      );
    });
    const sleep = vi.fn(async () => undefined);
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 18, assetsPerItem: 1, concurrency: 3 },
      { sleep },
    );

    const result = await collector.execute("test-adaptive-concurrency");

    expect(result.snapshot).toMatchObject({
      validAssetCount: 18,
      completionReason: "target_reached",
    });
    expect(apiCall).toHaveBeenCalledTimes(21);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1_000]);
    expect(store.checkpoint).toMatchObject({
      concurrency: 3,
      effectiveConcurrency: 2,
      quotaUnitsUsed: 27,
      cursorIndex: 18,
    });
  });

  it("migra un checkpoint 12→3 sin descartar resultados exitosos", async () => {
    const catalog = [
      redline,
      {
        markethashname: "AWP | Asiimov (Field-Tested)",
        itemgroup: "sniper rifle",
        pricereal: 200,
      },
      {
        markethashname: "M4A4 | The Emperor (Factory New)",
        itemgroup: "rifle",
        pricereal: 100,
      },
    ];
    const store = new MemoryMarketAssetsCatalogStore();
    const oldCollector = new CollectMarketAssetsCatalogUseCase(
      client(async (candidate, request) => {
        if (candidate.marketHashName.startsWith("AWP")) {
          throw new MarketAssetsApiError(
            "credenciales rechazadas durante el lote",
            "fatal",
            402,
            request.limit,
          );
        }
        return page(
          [rawMarketAsset(candidate.marketHashName, `old-${candidate.key}`)],
          request,
          1,
        );
      }),
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 3, assetsPerItem: 1, concurrency: 3 },
    );
    await expect(
      oldCollector.execute("test-old-concurrency"),
    ).rejects.toMatchObject({ status: 402, kind: "fatal" });
    expect(store.checkpoint?.assets).toHaveLength(2);
    store.checkpoint!.concurrency = 12;

    const resumedCalls: string[] = [];
    const resumedCollector = new CollectMarketAssetsCatalogUseCase(
      client(async (candidate, request) => {
        resumedCalls.push(candidate.marketHashName);
        return page(
          [rawMarketAsset(candidate.marketHashName, `new-${candidate.key}`)],
          request,
          1,
        );
      }),
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 3, assetsPerItem: 1, concurrency: 3 },
    );

    const result = await resumedCollector.execute("test-new-concurrency");

    expect(result.resumedCheckpoint).toBe(true);
    expect(resumedCalls).toEqual([catalog[1]!.markethashname]);
    expect(result.snapshot.assets.map((asset) => asset.listingName)).toEqual([
      redline.markethashname,
      catalog[1]!.markethashname,
      catalog[2]!.markethashname,
    ]);
    expect(store.checkpoint).toMatchObject({
      concurrency: 3,
      cursorIndex: 3,
    });
    expect(store.deletedCheckpoints).toBe(0);
  });

  it("no publica catálogo agotado tras agotar dos rondas diferidas", async () => {
    const catalog = [
      redline,
      {
        markethashname: "AWP | Asiimov (Field-Tested)",
        itemgroup: "sniper rifle",
        pricereal: 200,
      },
    ];
    const store = new MemoryMarketAssetsCatalogStore();
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(async (candidate, request) => {
        if (candidate.marketHashName.startsWith("AK-47")) {
          throw new MarketAssetsApiError(
            "timeout pendiente",
            "retryable",
            0,
            request.limit * 3,
          );
        }
        return page(
          [rawMarketAsset(candidate.marketHashName, "asiimov-ok")],
          request,
          1,
        );
      }),
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 3, assetsPerItem: 1, concurrency: 2 },
      { sleep: vi.fn(async () => undefined) },
    );

    await expect(
      collector.execute("test-deferred-exhaustion"),
    ).rejects.toThrow("timeout pendiente");
    expect(store.checkpoint).toMatchObject({
      cursorIndex: 0,
      assets: [expect.objectContaining({ assetId: "asiimov-ok" })],
    });
    const deferred = Object.values(
      store.checkpoint?.candidateProgress ?? {},
    ).find((progress) => progress.lastError === "timeout pendiente");
    expect(deferred).toMatchObject({
      completed: false,
      exhausted: false,
      deferredRecoveryAttempts: 2,
      consecutiveFailures: 3,
    });
  });

  it("publica el target fresco con warning durable si un diferido agotó sus rondas", async () => {
    const catalog = [
      redline,
      {
        markethashname: "AWP | Asiimov (Field-Tested)",
        itemgroup: "sniper rifle",
        pricereal: 200,
      },
      {
        markethashname: "M4A4 | The Emperor (Factory New)",
        itemgroup: "rifle",
        pricereal: 100,
      },
    ];
    const store = new MemoryMarketAssetsCatalogStore();
    const progressSpy = vi.fn(async () => undefined);
    const state = syncStateRepository();
    state.markCollectionProgress = progressSpy;
    const apiCall = vi.fn(async (candidate, request) => {
      if (candidate.marketHashName === redline.markethashname) {
        throw new MarketAssetsApiError(
          "timeout diferido definitivo",
          "retryable",
          0,
          request.limit,
          0,
          1,
          50,
          "timeout",
        );
      }
      return page(
        [rawMarketAsset(candidate.marketHashName, `fresh-${candidate.key}`)],
        request,
        1,
      );
    });
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue(catalog),
      store,
      state,
      undefined,
      { targetAssets: 2, assetsPerItem: 1, concurrency: 2 },
      { sleep: vi.fn(async () => undefined) },
    );

    const result = await collector.execute("test-target-with-deferred-warning");

    expect(result.snapshot).toMatchObject({
      validAssetCount: 2,
      completionReason: "target_reached",
    });
    expect(apiCall.mock.calls.filter(([candidate]) =>
      candidate.marketHashName === redline.markethashname,
    )).toHaveLength(3);
    const deferred = Object.values(store.checkpoint!.candidateProgress).find(
      (progress) => progress.lastError === "timeout diferido definitivo",
    );
    expect(deferred).toMatchObject({
      completed: true,
      exhausted: false,
      consecutiveFailures: 3,
      deferredRecoveryAttempts: 2,
    });
    expect(
      progressSpy.mock.calls.at(-1)![2].telemetry.deferredCandidateCount,
    ).toBe(1);
  });

  it("usa un hint exitoso sólo para el límite inicial y pagina si creció el total", async () => {
    const store = new MemoryMarketAssetsCatalogStore();
    const calls: Array<{ limit: number; offset: number }> = [];
    const historyRepository: IMarketAssetCandidateHistoryRepository = {
      async getByCandidateKeys(keys) {
        return keys.map((candidateKey) => ({
          candidateKey,
          queueVersion: "previous",
          marketHashName: redline.markethashname,
          outcome: "available" as const,
          providerTotal: 2,
          rawAssetCount: 2,
          validAssetCount: 2,
          skippedAssetCount: 0,
          pageRequests: 1,
          httpAttempts: 1,
          latencyMs: 5,
          lastOffset: 2,
          observedAt: new Date("2026-07-20T00:00:00.000Z"),
          runId: null,
          effectiveConcurrency: 1,
          errorStatus: null,
          errorMessage: null,
        }));
      },
      recordObservations: vi.fn(async () => undefined),
      prune: vi.fn(async () => 0),
    };
    const apiCall = vi.fn(async (candidate, request) => {
      calls.push({ limit: request.limit, offset: request.offset });
      return page(
        Array.from({ length: request.limit }, (_, index) =>
          rawMarketAsset(
            candidate.marketHashName,
            `history-${request.offset + index}`,
          ),
        ),
        request,
        5,
      );
    });
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue([redline]),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 5, assetsPerItem: 5, concurrency: 1 },
      {
        sleep: vi.fn(async () => undefined),
        historyRepository,
      },
    );

    const result = await collector.execute("test-history-limit");

    expect(calls).toEqual([
      { limit: 2, offset: 0 },
      { limit: 3, offset: 2 },
    ]);
    expect(result.snapshot.validAssetCount).toBe(5);
    expect(historyRepository.prune).toHaveBeenCalledOnce();
    expect(historyRepository.recordObservations).toHaveBeenCalledWith(
      null,
      [
        expect.objectContaining({
          outcome: "available",
          providerTotal: 5,
          validAssetCount: 5,
          pageRequests: 2,
          latencyMs: 10,
        }),
      ],
    );
  });

  it("no dispara candidatos posteriores cuando el primero falla fatalmente", async () => {
    const apiCall = vi.fn(
      async (
        _candidate: MarketAssetsPriorityCandidate,
        request: MarketAssetsPageRequest,
      ) => {
        throw new MarketAssetsApiError(
          "API key inválida",
          "fatal",
          403,
          request.limit,
        );
      },
    );
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue([
        redline,
        {
          markethashname: "AWP | Asiimov (Field-Tested)",
          itemgroup: "sniper rifle",
          pricereal: 200,
        },
      ]),
      new MemoryMarketAssetsCatalogStore(),
      syncStateRepository(),
      undefined,
      { targetAssets: 10, assetsPerItem: 10, concurrency: 1 },
    );

    await expect(collector.execute("test-fatal")).rejects.toMatchObject({
      status: 403,
      kind: "fatal",
    });
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("valida un checkpoint de forma read-only contra hash y configuración", async () => {
    const store = new MemoryMarketAssetsCatalogStore();
    const options = { targetAssets: 1, assetsPerItem: 1, concurrency: 1 };
    const stableCollector = new CollectMarketAssetsCatalogUseCase(
      client(async (candidate, request) =>
        page(
          [rawMarketAsset(candidate.marketHashName, "probe-compatible")],
          request,
          1,
        ),
      ),
      priorityQueue([redline]),
      store,
      syncStateRepository(),
      undefined,
      options,
    );
    await stableCollector.execute("test-compatible-probe");

    await expect(stableCollector.hasCompatibleCheckpoint()).resolves.toBe(true);
    const changedQueueCollector = new CollectMarketAssetsCatalogUseCase(
      client(vi.fn()),
      priorityQueue([{ ...redline, pricereal: 301 }]),
      store,
      syncStateRepository(),
      undefined,
      options,
    );
    await expect(
      changedQueueCollector.hasCompatibleCheckpoint(),
    ).resolves.toBe(false);
    expect(store.deletedCheckpoints).toBe(0);
    expect(store.checkpoint).not.toBeNull();
  });

  it("rechaza concurrencia configurada por encima del máximo físico de tres", () => {
    expect(
      () =>
        new CollectMarketAssetsCatalogUseCase(
          client(vi.fn()),
          priorityQueue([redline]),
          new MemoryMarketAssetsCatalogStore(),
          syncStateRepository(),
          undefined,
          { targetAssets: 10, assetsPerItem: 10, concurrency: 4 },
        ),
    ).toThrow("MARKET_ASSETS_CONCURRENCY debe estar entre 1 y 3");
  });
});
