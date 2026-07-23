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
import type { MarketAssetsCollectionCheckpoint } from "../../domain/MarketAssetsCatalog";
import { marketAssetsShutdownCoordinator } from "../MarketAssetsShutdownCoordinator";
import { marketSyncProgressService } from "../MarketSyncProgressService";
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForGateOrCancellation(
  gate: Promise<void>,
  request: MarketAssetsPageRequest,
): Promise<void> {
  if (!request.signal) {
    await gate;
    return;
  }
  if (request.signal.aborted) {
    throw new MarketAssetsApiError(
      "worker cancelado",
      "retryable",
      0,
      0,
      0,
      0,
      0,
      "cancelled",
    );
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      reject(
        new MarketAssetsApiError(
          "worker cancelado",
          "retryable",
          0,
          0,
          0,
          0,
          0,
          "cancelled",
        ),
      );
    };
    request.signal!.addEventListener("abort", onAbort, { once: true });
    gate.then(
      () => {
        request.signal!.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        request.signal!.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(message);
}

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

  it("reutiliza un slot continuo mientras el candidato prioritario sigue lento y ordena el resultado por prioridad", async () => {
    const catalog = [
      {
        markethashname: "AK-47 | Worker A (Factory New)",
        itemgroup: "rifle",
        pricereal: 400,
      },
      {
        markethashname: "AK-47 | Worker B (Factory New)",
        itemgroup: "rifle",
        pricereal: 300,
      },
      {
        markethashname: "AK-47 | Worker C (Factory New)",
        itemgroup: "rifle",
        pricereal: 200,
      },
      {
        markethashname: "AK-47 | Worker D (Factory New)",
        itemgroup: "rifle",
        pricereal: 100,
      },
    ];
    const gates = new Map(
      catalog.map((item) => [item.markethashname, deferred<void>()]),
    );
    const started: string[] = [];
    let active = 0;
    let peakActive = 0;
    let nowMs = Date.UTC(2026, 6, 23);
    let slowCandidateResolved = false;
    const apiCall = vi.fn(async (candidate, request) => {
      started.push(candidate.marketHashName);
      active++;
      peakActive = Math.max(peakActive, active);
      try {
        await gates.get(candidate.marketHashName)!.promise;
        return {
          ...page(
            [
              rawMarketAsset(
                candidate.marketHashName,
                `asset-${candidate.key}`,
              ),
            ],
            request,
            1,
          ),
          durationMs: candidate.marketHashName.includes("Worker A")
            ? 30_000
            : 1_000,
        };
      } finally {
        active--;
      }
    });
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue(catalog),
      new MemoryMarketAssetsCatalogStore(),
      syncStateRepository(),
      undefined,
      {
        targetAssets: 4,
        assetsPerItem: 1,
        initialConcurrency: 3,
        concurrency: 3,
      },
      {
        now: () => nowMs,
        sleep: vi.fn(async (delay) => {
          nowMs += delay;
        }),
      },
    );

    const execution = collector.execute("test-continuous-pool");
    await waitUntil(
      () => started.length === 3,
      "El pool no inició sus tres workers configurados.",
    );
    expect(started).toEqual(
      catalog.slice(0, 3).map((item) => item.markethashname),
    );

    nowMs += 1_000;
    gates.get(catalog[1]!.markethashname)!.resolve(undefined);
    gates.get(catalog[2]!.markethashname)!.resolve(undefined);
    await waitUntil(
      () => started.includes(catalog[3]!.markethashname),
      "El dispatcher no reutilizó un slot liberado.",
    );

    expect(slowCandidateResolved).toBe(false);
    expect(started).toContain(catalog[3]!.markethashname);
    expect(peakActive).toBeLessThanOrEqual(3);

    nowMs += 1_000;
    gates.get(catalog[3]!.markethashname)!.resolve(undefined);
    nowMs = Date.UTC(2026, 6, 23) + 30_000;
    slowCandidateResolved = true;
    gates.get(catalog[0]!.markethashname)!.resolve(undefined);

    const { snapshot } = await execution;
    expect(snapshot.assets.map((asset) => asset.listingName)).toEqual(
      catalog.map((item) => item.markethashname),
    );
    expect(apiCall).toHaveBeenCalledTimes(4);
    expect(peakActive).toBe(3);
  });

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

  it("ante un fatal detiene nuevos despachos, incorpora los workers activos y fuerza el checkpoint", async () => {
    const catalog = [
      {
        markethashname: "AK-47 | Fatal A (Factory New)",
        itemgroup: "rifle",
        pricereal: 400,
      },
      {
        markethashname: "AK-47 | Fatal B (Factory New)",
        itemgroup: "rifle",
        pricereal: 300,
      },
      {
        markethashname: "AK-47 | Fatal C (Factory New)",
        itemgroup: "rifle",
        pricereal: 200,
      },
      {
        markethashname: "AK-47 | Fatal D (Factory New)",
        itemgroup: "rifle",
        pricereal: 100,
      },
    ];
    const activeA = deferred<void>();
    const activeC = deferred<void>();
    const started: string[] = [];
    const store = new MemoryMarketAssetsCatalogStore();
    const apiCall = vi.fn(async (candidate, request) => {
      started.push(candidate.marketHashName);
      if (candidate.marketHashName.includes("Fatal A")) {
        await activeA.promise;
      }
      if (candidate.marketHashName.includes("Fatal B")) {
        throw new MarketAssetsApiError(
          "credenciales rechazadas",
          "fatal",
          403,
          request.limit,
        );
      }
      if (candidate.marketHashName.includes("Fatal C")) {
        await activeC.promise;
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
      {
        targetAssets: 4,
        assetsPerItem: 1,
        initialConcurrency: 3,
        concurrency: 3,
      },
    );

    const execution = collector.execute("test-concurrent-fatal");
    await waitUntil(
      () => started.length === 3,
      "El pool fatal no inició los tres candidatos esperados.",
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(started).not.toContain(catalog[3]!.markethashname);

    activeC.resolve(undefined);
    activeA.resolve(undefined);
    await expect(execution).rejects.toMatchObject({
      status: 403,
      kind: "fatal",
    });

    expect(started).toEqual(
      catalog.slice(0, 3).map((item) => item.markethashname),
    );
    expect(store.checkpointWrites.length).toBeGreaterThan(1);
    expect(store.checkpoint).toMatchObject({
      schemaVersion: 4,
      cursorIndex: 1,
      candidatesVisited: 2,
      quotaUnitsUsed: 3,
    });
    expect(
      new Set(store.checkpoint?.assets.map((asset) => asset.listingName)),
    ).toEqual(
      new Set([
        catalog[0]!.markethashname,
        catalog[2]!.markethashname,
      ]),
    );
    expect(
      Object.values(store.checkpoint?.candidateProgress ?? {}).find(
        (progress) => progress.lastError === "credenciales rechazadas",
      ),
    ).toMatchObject({
      completed: false,
      exhausted: false,
      lastError: "credenciales rechazadas",
    });
  });

  it("checkpointa un 429, limita sus reintentos y reanuda en otra ejecución", async () => {
    const store = new MemoryMarketAssetsCatalogStore();
    let nowMs = Date.now();
    const sleep = vi.fn(async (delay: number) => {
      nowMs += delay;
    });
    const runtime = {
      now: () => nowMs,
      sleep,
    };
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
      runtime,
    );

    await expect(interrupted.execute("test-429")).rejects.toMatchObject({
      status: 429,
      kind: "retryable",
    });
    expect(rateLimitedCall).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1_000, 1_000]);
    expect(store.checkpoint).toMatchObject({
      schemaVersion: 4,
      quotaUnitsUsed: 30,
      circuitBreaker: {
        state: "open",
        openCount: 3,
        resumeAt: expect.any(String),
      },
    });
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
    nowMs = Math.max(
      nowMs,
      Date.parse(store.checkpoint!.circuitBreaker.resumeAt!),
    );
    const recovered = new CollectMarketAssetsCatalogUseCase(
      client(recoveredCall),
      priorityQueue([redline]),
      store,
      syncStateRepository(),
      undefined,
      options,
      runtime,
    );

    const result = await recovered.execute("test-429");

    expect(result.resumedCheckpoint).toBe(true);
    expect(result.snapshot.validAssetCount).toBe(10);
    expect(recoveredCall).toHaveBeenCalledTimes(1);
    expect(store.checkpoint).toMatchObject({ quotaUnitsUsed: 40 });
  });

  it("difiere un timeout aislado y omite su recuperación cuando ya alcanzó el target fresco", async () => {
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
      catalog[1]!.markethashname,
      catalog[2]!.markethashname,
    ]);
    expect(redlineCalls).toBe(1);
    const deferredProgress = Object.values(
      store.checkpoint?.candidateProgress ?? {},
    ).find((progress) => progress.lastError === "timeout agotado");
    expect(deferredProgress).toMatchObject({
      completed: true,
      exhausted: true,
      consecutiveFailures: 1,
      deferredRecoveryAttempts: 0,
      lastError: "timeout agotado",
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

  it("publica el target fresco con warning durable sin gastar rondas diferidas innecesarias", async () => {
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
    expect(result.snapshot.assets.map((asset) => asset.listingName)).toEqual([
      catalog[1]!.markethashname,
      catalog[2]!.markethashname,
    ]);
    expect(apiCall.mock.calls.filter(([candidate]) =>
      candidate.marketHashName === redline.markethashname,
    )).toHaveLength(1);
    const deferred = Object.values(store.checkpoint!.candidateProgress).find(
      (progress) => progress.lastError === "timeout diferido definitivo",
    );
    expect(deferred).toMatchObject({
      completed: true,
      exhausted: true,
      consecutiveFailures: 1,
      deferredRecoveryAttempts: 0,
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

  it("durante un shutdown aborta y drena el pool, fuerza checkpoint y no devuelve un snapshot parcial", async () => {
    const catalog = Array.from({ length: 4 }, (_, index) => ({
      markethashname: `AK-47 | Shutdown ${index} (Factory New)`,
      itemgroup: "rifle",
      pricereal: 400 - index,
    }));
    const firstGate = deferred<void>();
    const never = deferred<void>();
    const started: string[] = [];
    let activeWorkers = 0;
    const store = new MemoryMarketAssetsCatalogStore();
    const apiCall = vi.fn(async (candidate, request) => {
      started.push(candidate.marketHashName);
      activeWorkers++;
      try {
        await waitForGateOrCancellation(
          candidate.marketHashName === catalog[0]!.markethashname
            ? firstGate.promise
            : never.promise,
          request,
        );
        return page(
          [rawMarketAsset(candidate.marketHashName, `asset-${candidate.key}`)],
          request,
          1,
        );
      } finally {
        activeWorkers--;
      }
    });
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      {
        targetAssets: 4,
        assetsPerItem: 1,
        initialConcurrency: 3,
        concurrency: 3,
      },
    );

    const execution = collector.execute("test-graceful-shutdown");
    const interrupted = expect(execution).rejects.toMatchObject({
      name: "MarketAssetsCollectionInterruptedError",
    });
    await waitUntil(
      () => started.length === 3,
      "El pool no inició antes de solicitar el shutdown.",
    );
    firstGate.resolve(undefined);
    await waitUntil(
      () => started.length === 4,
      "El dispatcher no reutilizó el slot antes del shutdown.",
    );

    const shutdown = marketAssetsShutdownCoordinator.prepareForShutdown();
    await interrupted;
    await shutdown;

    expect(activeWorkers).toBe(0);
    expect(marketAssetsShutdownCoordinator.hasActiveCollection()).toBe(false);
    expect(store.snapshot).toBeNull();
    expect(store.checkpointWrites.length).toBeGreaterThan(1);
    expect(store.checkpoint).toMatchObject({
      schemaVersion: 4,
      cursorIndex: 1,
      assets: [
        expect.objectContaining({
          listingName: catalog[0]!.markethashname,
        }),
      ],
    });
  });

  it("si writeCheckpoint falla con el pool activo, drena todos los workers y el flush final conserva los éxitos integrados", async () => {
    class FailOnceCheckpointStore extends MemoryMarketAssetsCatalogStore {
      writeAttempts = 0;

      override async writeCheckpoint(
        checkpoint: MarketAssetsCollectionCheckpoint,
      ): Promise<void> {
        this.writeAttempts++;
        if (this.writeAttempts === 2) {
          throw new Error("fallo temporal al escribir checkpoint");
        }
        await super.writeCheckpoint(checkpoint);
      }
    }

    const catalog = Array.from({ length: 3 }, (_, index) => ({
      markethashname: `AK-47 | Checkpoint ${index} (Factory New)`,
      itemgroup: "rifle",
      pricereal: 300 - index,
    }));
    const firstGate = deferred<void>();
    const never = deferred<void>();
    const started: string[] = [];
    let activeWorkers = 0;
    let nowMs = Date.now();
    const store = new FailOnceCheckpointStore();
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(async (candidate, request) => {
        started.push(candidate.marketHashName);
        activeWorkers++;
        try {
          await waitForGateOrCancellation(
            candidate.marketHashName === catalog[0]!.markethashname
              ? firstGate.promise
              : never.promise,
            request,
          );
          return page(
            [
              rawMarketAsset(
                candidate.marketHashName,
                `asset-${candidate.key}`,
              ),
            ],
            request,
            1,
          );
        } finally {
          activeWorkers--;
        }
      }),
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      {
        targetAssets: 3,
        assetsPerItem: 1,
        initialConcurrency: 3,
        concurrency: 3,
      },
      {
        now: () => nowMs,
        sleep: vi.fn(async (delay) => {
          nowMs += delay;
        }),
      },
    );

    const execution = collector.execute("test-checkpoint-write-failure");
    await waitUntil(
      () => started.length === 3,
      "El pool no estaba activo al preparar la falla del checkpoint.",
    );
    nowMs += 1_001;
    firstGate.resolve(undefined);

    await expect(execution).rejects.toThrow(
      "fallo temporal al escribir checkpoint",
    );

    expect(activeWorkers).toBe(0);
    expect(store.writeAttempts).toBe(3);
    expect(store.snapshot).toBeNull();
    expect(store.checkpoint).toMatchObject({
      cursorIndex: 1,
      assets: [
        expect.objectContaining({
          listingName: catalog[0]!.markethashname,
        }),
      ],
    });
  });

  it("corta una página llena repetida sin progreso y no entra en un loop infinito", async () => {
    const repeatedAssets = Array.from({ length: 10 }, (_, index) =>
      rawMarketAsset(redline.markethashname, `invalid-repeated-${index}`, {
        price: 0,
      }),
    );
    const offsets: number[] = [];
    let nowMs = Date.now();
    const store = new MemoryMarketAssetsCatalogStore();
    const apiCall = vi.fn(async (_candidate, request) => {
      offsets.push(request.offset);
      return page(repeatedAssets, request, 100);
    });
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue([redline]),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 10, assetsPerItem: 10, concurrency: 1 },
      {
        now: () => nowMs,
        sleep: vi.fn(async (delay) => {
          nowMs += delay;
        }),
      },
    );

    await expect(
      collector.execute("test-repeated-provider-page"),
    ).rejects.toThrow("repitió la misma página");

    expect(apiCall).toHaveBeenCalledTimes(6);
    expect(offsets).toEqual([0, 10, 10, 20, 20, 30]);
    expect(store.checkpoint).toMatchObject({
      cursorIndex: 0,
      assets: [],
    });
    expect(
      Object.values(store.checkpoint!.candidateProgress)[0],
    ).toMatchObject({
      offset: 30,
      deferredRecoveryAttempts: 2,
      completed: false,
      exhausted: false,
    });
  });

  it("calcula demanda y tenMinuteTargetUnreachable con el prefijo publicable, no con assets inferiores fuera de orden", async () => {
    const catalog = [
      {
        markethashname: "AK-47 | Priority Slow (Factory New)",
        itemgroup: "rifle",
        pricereal: 200,
      },
      {
        markethashname: "AK-47 | Priority Fast (Factory New)",
        itemgroup: "rifle",
        pricereal: 100,
      },
    ];
    const slowGate = deferred<void>();
    const fastGate = deferred<void>();
    const started: string[] = [];
    let nowMs = Date.now();
    const store = new MemoryMarketAssetsCatalogStore();
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(async (candidate, request) => {
        started.push(candidate.marketHashName);
        await (
          candidate.marketHashName === catalog[0]!.markethashname
            ? slowGate.promise
            : fastGate.promise
        );
        return page(
          [rawMarketAsset(candidate.marketHashName, `asset-${candidate.key}`)],
          request,
          1,
        );
      }),
      priorityQueue(catalog),
      store,
      syncStateRepository(),
      undefined,
      {
        targetAssets: 1,
        assetsPerItem: 1,
        initialConcurrency: 2,
        concurrency: 2,
        targetDurationSeconds: 1,
      },
      {
        now: () => nowMs,
        sleep: vi.fn(async (delay) => {
          nowMs += delay;
        }),
      },
    );

    const execution = collector.execute("test-publishable-prefix-demand");
    await waitUntil(
      () => started.length === 2,
      "El pool no inició los dos candidatos de prioridad.",
    );
    nowMs += 5_000;
    fastGate.resolve(undefined);
    await waitUntil(
      () =>
        store.checkpoint?.assets.some(
          (asset) => asset.listingName === catalog[1]!.markethashname,
        ) === true,
      "El asset inferior no se integró antes de completar el prefijo.",
    );

    expect(store.checkpoint).toMatchObject({
      cursorIndex: 0,
      tenMinuteTargetUnreachable: true,
      assets: [
        expect.objectContaining({
          listingName: catalog[1]!.markethashname,
        }),
      ],
    });
    expect(marketSyncProgressService.getWorkerRuntime()).toMatchObject({
      requiredConcurrency: 2,
      inFlight: 1,
      tenMinuteTargetUnreachable: true,
    });

    slowGate.resolve(undefined);
    const result = await execution;
    expect(result.snapshot.assets).toHaveLength(1);
    expect(result.snapshot.assets[0]!.listingName).toBe(
      catalog[0]!.markethashname,
    );
    expect(store.checkpoint?.tenMinuteTargetUnreachable).toBe(true);
    marketSyncProgressService.clearWorkerRuntime();
  });

  it("un éxito parcial seguido de error conserva el límite de dos recuperaciones diferidas", async () => {
    let callIndex = 0;
    let nowMs = Date.now();
    const store = new MemoryMarketAssetsCatalogStore();
    const apiCall = vi.fn(async (candidate, request) => {
      callIndex++;
      if (callIndex % 2 === 1) {
        return page(
          [
            rawMarketAsset(
              candidate.marketHashName,
              `partial-${Math.ceil(callIndex / 2)}`,
            ),
          ],
          request,
          100,
        );
      }
      throw new MarketAssetsApiError(
        `timeout parcial ${callIndex / 2}`,
        "retryable",
        0,
        request.limit,
        0,
        1,
        100,
        "timeout",
      );
    });
    const collector = new CollectMarketAssetsCatalogUseCase(
      client(apiCall),
      priorityQueue([redline]),
      store,
      syncStateRepository(),
      undefined,
      { targetAssets: 10, assetsPerItem: 10, concurrency: 1 },
      {
        now: () => nowMs,
        sleep: vi.fn(async (delay) => {
          nowMs += delay;
        }),
      },
    );

    await expect(
      collector.execute("test-partial-success-recovery-cap"),
    ).rejects.toThrow("timeout parcial 3");

    expect(apiCall).toHaveBeenCalledTimes(6);
    expect(store.checkpoint?.assets.map((asset) => asset.assetId)).toEqual([
      "partial-1",
      "partial-2",
      "partial-3",
    ]);
    expect(
      Object.values(store.checkpoint!.candidateProgress)[0],
    ).toMatchObject({
      validAssetCount: 3,
      deferredRecoveryAttempts: 2,
      completed: false,
      exhausted: false,
    });
  });

  it("acepta hasta 48 workers y rechaza cualquier techo superior", () => {
    expect(
      () =>
        new CollectMarketAssetsCatalogUseCase(
          client(vi.fn()),
          priorityQueue([redline]),
          new MemoryMarketAssetsCatalogStore(),
          syncStateRepository(),
          undefined,
          {
            targetAssets: 10,
            assetsPerItem: 10,
            initialConcurrency: 48,
            concurrency: 48,
          },
        ),
    ).not.toThrow();
    expect(
      () =>
        new CollectMarketAssetsCatalogUseCase(
          client(vi.fn()),
          priorityQueue([redline]),
          new MemoryMarketAssetsCatalogStore(),
          syncStateRepository(),
          undefined,
          { targetAssets: 10, assetsPerItem: 10, concurrency: 49 },
        ),
    ).toThrow("MARKET_ASSETS_CONCURRENCY debe estar entre 1 y 48");
  });
});
