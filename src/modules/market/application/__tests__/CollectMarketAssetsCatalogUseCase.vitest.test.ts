import { describe, expect, it, vi } from "vitest";
import { CollectMarketAssetsCatalogUseCase } from "../CollectMarketAssetsCatalogUseCase";
import {
  MarketAssetsApiError,
  type IMarketAssetsCatalogClient,
  type MarketAssetsCandidatePage,
  type MarketAssetsPageRequest,
} from "../IMarketAssetsCatalogClient";
import type { MarketAssetsPriorityCandidate } from "../MarketAssetsPriorityQueue";
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
        { targetAssets: 10_000, assetsPerItem: 10, concurrency: 50 },
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

  it("difiere un timeout aislado y continúa con las siguientes listings", async () => {
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
    const apiCall = vi.fn(async (candidate, request) => {
      if (candidate.marketHashName.startsWith("AK-47")) {
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
    );

    const result = await collector.execute("test-deferred-timeout");

    expect(result.snapshot.validAssetCount).toBe(2);
    expect(result.snapshot.completionReason).toBe("target_reached");
    expect(result.snapshot.assets.map((asset) => asset.listingName)).toEqual([
      catalog[1]!.markethashname,
      catalog[2]!.markethashname,
    ]);
    const deferred = Object.values(
      store.checkpoint?.candidateProgress ?? {},
    ).find((progress) => progress.lastError === "timeout agotado");
    expect(deferred).toMatchObject({
      completed: true,
      exhausted: true,
      consecutiveFailures: 1,
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
    expect(apiCall).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(
      Object.values(store.checkpoint?.candidateProgress ?? {}).every(
        (progress) => !progress.completed,
      ),
    ).toBe(true);
  });

  it("degrada 12→6→3→1 y continúa si el probe serial responde", async () => {
    const catalog = Array.from({ length: 12 }, (_, index) => ({
      markethashname: `AK-47 | Adaptive ${String(index).padStart(2, "0")} (Factory New)`,
      itemgroup: "rifle",
      pricereal: 1_000 - index,
    }));
    const store = new MemoryMarketAssetsCatalogStore();
    let calls = 0;
    const apiCall = vi.fn(async (candidate, request) => {
      calls++;
      // Lotes fallidos de 12, 6 y 3. Desde el probe serial la API se recupera.
      if (calls <= 21) {
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
      { targetAssets: 12, assetsPerItem: 1, concurrency: 12 },
      { sleep },
    );

    const result = await collector.execute("test-adaptive-concurrency");

    expect(result.snapshot).toMatchObject({
      validAssetCount: 12,
      completionReason: "target_reached",
    });
    expect(apiCall).toHaveBeenCalledTimes(33);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([
      1_000, 2_000, 4_000,
    ]);
    expect(store.checkpoint).toMatchObject({
      concurrency: 12,
      quotaUnitsUsed: 75,
      cursorIndex: 12,
    });
  });

  it("migra un checkpoint 12→3 y reabre listings prioritarias diferidas", async () => {
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
        if (candidate.marketHashName === redline.markethashname) {
          throw new MarketAssetsApiError(
            "timeout con concurrencia antigua",
            "retryable",
            0,
            request.limit * 3,
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
      { targetAssets: 2, assetsPerItem: 1, concurrency: 2 },
    );
    await oldCollector.execute("test-old-concurrency");
    expect(store.checkpoint?.cursorIndex).toBe(3);
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
      { targetAssets: 2, assetsPerItem: 1, concurrency: 3 },
    );

    const result = await resumedCollector.execute("test-new-concurrency");

    expect(result.resumedCheckpoint).toBe(true);
    expect(resumedCalls).toEqual([redline.markethashname]);
    expect(result.snapshot.assets.map((asset) => asset.listingName)).toEqual([
      redline.markethashname,
      catalog[1]!.markethashname,
    ]);
    expect(store.checkpoint).toMatchObject({
      concurrency: 3,
      cursorIndex: 3,
    });
    expect(store.deletedCheckpoints).toBe(0);
  });

  it("no publica catálogo agotado si quedaron listings diferidas", async () => {
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
    );

    await expect(
      collector.execute("test-deferred-exhaustion"),
    ).rejects.toThrow("Quedaron 1 listings con errores transitorios");
    expect(store.checkpoint).toMatchObject({
      cursorIndex: 0,
      assets: [expect.objectContaining({ assetId: "asiimov-ok" })],
    });
    const deferred = Object.values(
      store.checkpoint?.candidateProgress ?? {},
    ).find((progress) => progress.lastError === "timeout pendiente");
    expect(deferred).toMatchObject({ completed: false, exhausted: false });
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
});
