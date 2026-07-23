import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rateLimiter = vi.hoisted(() => ({
  acquire: vi.fn(async () => undefined),
  observeHeaders: vi.fn(async () => undefined),
  penalize: vi.fn(async () => undefined),
  getSnapshot: vi.fn(() => ({
    configuredCapacity: 10_000,
    effectiveCapacity: 10_000,
    availableTokens: 10_000,
    quotaUnitsUsed: 0,
    rowsUsed: 0,
    cooldownUntil: 0,
    windowStartedAt: 0,
    windowResetsAt: 60_000,
  })),
}));

vi.mock("../../application/FloatRateLimiter", () => ({
  floatRateLimiter: rateLimiter,
  FloatRateLimitAcquireCancelledError: class extends Error {
    constructor() {
      super("cancelled");
      this.name = "FloatRateLimitAcquireCancelledError";
    }
  },
}));

import type { MarketAssetsPriorityCandidate } from "../../application/MarketAssetsPriorityQueue";
import { SteamWebApiFloatAssetsClient } from "../SteamWebApiFloatAssetsClient";
import { SteamWebApiMarketAssetsCatalogClient } from "../SteamWebApiMarketAssetsCatalogClient";

const candidate: MarketAssetsPriorityCandidate = {
  key: "ak-redline-field-tested",
  marketHashName: "AK-47 | Redline (Field-Tested)",
  queryMarketHashName: "AK-47 | Redline (Field-Tested)",
  priorityPrice: 300,
  catalogImageUrl: "https://example.test/redline.png",
  phase: null,
  paintIndex: null,
  wear: "FT",
  defIndex: 7,
  isStatTrak: false,
  isSouvenir: false,
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "10000",
      "x-ratelimit-remaining": "9990",
      "x-ratelimit-reset": "60",
    },
  });
}

function createClient(): SteamWebApiMarketAssetsCatalogClient {
  return new SteamWebApiMarketAssetsCatalogClient(
    new SteamWebApiFloatAssetsClient("test-api-key"),
  );
}

describe("SteamWebApiMarketAssetsCatalogClient", () => {
  beforeEach(() => {
    rateLimiter.acquire.mockReset();
    rateLimiter.acquire.mockImplementation(
      async (_units: number, options?: { beforeReserve?: () => Promise<void> }) => {
        await options?.beforeReserve?.();
      },
    );
    rateLimiter.observeHeaders.mockClear();
    rateLimiter.penalize.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("envía limit, offset y sort exactos al endpoint float/assets", async () => {
    const fetchMock = vi.fn(async () =>
      response(200, {
        data: [],
        total: 0,
        limit: 7,
        offset: 130,
        sort: "newest",
        credits_used: 0.7,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createClient().fetchCandidatePage(candidate, {
      limit: 7,
      offset: 130,
      sort: "newest",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      "https://www.steamwebapi.com/steam/api/float/assets",
    );
    expect(requestUrl.searchParams.get("limit")).toBe("7");
    expect(requestUrl.searchParams.get("offset")).toBe("130");
    expect(requestUrl.searchParams.get("sort")).toBe("newest");
    expect(requestUrl.searchParams.get("market_hash_name")).toBe(
      candidate.queryMarketHashName,
    );
    expect(requestUrl.searchParams.get("with_items")).toBe("0");
    expect(rateLimiter.acquire).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ priority: "sync" }),
    );
    expect(result).toMatchObject({
      assets: [],
      providerTotal: 0,
      limit: 7,
      offset: 130,
      quotaUnitsUsed: 7,
      creditsUsed: 0.7,
    });
  });

  it("filtra fases por paint_index sin enviar el phase incompatible", async () => {
    const fetchMock = vi.fn(async () =>
      response(200, {
        data: [],
        total: 0,
        limit: 10,
        offset: 0,
        sort: "newest",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const phaseCandidate: MarketAssetsPriorityCandidate = {
      ...candidate,
      key: "butterfly-black-pearl-fn",
      marketHashName:
        "★ Butterfly Knife | Doppler | Black Pearl (Factory New)",
      queryMarketHashName: "★ Butterfly Knife | Doppler (Factory New)",
      phase: "Black Pearl",
      paintIndex: 417,
      defIndex: 515,
      wear: "FN",
    };

    await createClient().fetchCandidatePage(phaseCandidate, {
      limit: 10,
      offset: 0,
      sort: "newest",
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(requestUrl.searchParams.get("market_hash_name")).toBe(
      phaseCandidate.queryMarketHashName,
    );
    expect(requestUrl.searchParams.get("paint_index")).toBe("417");
    expect(requestUrl.searchParams.has("phase")).toBe(false);
    expect(requestUrl.searchParams.get("def_index")).toBe("515");
    expect(requestUrl.searchParams.get("wear")).toBe("FN");
    expect(requestUrl.searchParams.get("is_stattrak")).toBe("0");
    expect(requestUrl.searchParams.get("is_souvenir")).toBe("0");
  });

  it("consulta una fase Glock con nombre base, paint index, desgaste, def index y flags", async () => {
    const fetchMock = vi.fn(async () =>
      response(200, { data: [], total: 0, limit: 10, offset: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const glock: MarketAssetsPriorityCandidate = {
      ...candidate,
      key: "glock-gamma-emerald-fn-stattrak",
      marketHashName:
        "StatTrak™ Glock-18 | Gamma Doppler | Emerald (Factory New)",
      queryMarketHashName:
        "StatTrak™ Glock-18 | Gamma Doppler (Factory New)",
      phase: "Emerald",
      paintIndex: 568,
      defIndex: 4,
      wear: "FN",
      isStatTrak: true,
    };

    await createClient().fetchCandidatePage(glock, {
      limit: 10,
      offset: 0,
      sort: "newest",
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(requestUrl.searchParams.get("market_hash_name")).toBe(
      glock.queryMarketHashName,
    );
    expect(requestUrl.searchParams.get("paint_index")).toBe("568");
    expect(requestUrl.searchParams.get("wear")).toBe("FN");
    expect(requestUrl.searchParams.get("def_index")).toBe("4");
    expect(requestUrl.searchParams.get("is_stattrak")).toBe("1");
    expect(requestUrl.searchParams.get("is_souvenir")).toBe("0");
    expect(requestUrl.searchParams.has("phase")).toBe(false);
  });

  it("usa with_items sólo como fallback si el catálogo no aporta imagen", async () => {
    const fetchMock = vi.fn(async () =>
      response(200, { data: [], total: 0, limit: 10, offset: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createClient().fetchCandidatePage(
      { ...candidate, catalogImageUrl: null },
      { limit: 10, offset: 0, sort: "newest" },
    );

    const requestUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(requestUrl.searchParams.get("with_items")).toBe("1");
  });

  it("propaga un 5xx tras un único intento HTTP", async () => {
    const fetchMock = vi.fn(async () =>
      response(503, { error: "upstream unavailable" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createClient().fetchCandidatePage(candidate, {
        limit: 10,
        offset: 0,
        sort: "newest",
      }),
    ).rejects.toMatchObject({
      kind: "retryable",
      status: 503,
      httpAttempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("trata un JSON 200 truncado como transitorio y no reintenta internamente", async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{"data":[', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createClient().fetchCandidatePage(candidate, {
        limit: 10,
        offset: 0,
        sort: "newest",
      }),
    ).rejects.toMatchObject({
      kind: "retryable",
      status: 200,
      failureKind: "http_transient",
      httpAttempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("mantiene el timeout activo mientras el body permanece bloqueado", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                const error = new Error("body aborted");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SteamWebApiFloatAssetsClient(
      "test-api-key",
    ).fetchPage({
      source: "youpin",
      marketHashName: candidate.marketHashName,
      limit: 1,
      offset: 0,
      requestTimeoutMs: 10,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 0,
      outcome: "timeout",
      quotaUnitsUsed: 1,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("obtiene admisión antes del fetch y retroalimenta el pacer una vez por respuesta física", async () => {
    const pacer = {
      acquire: vi.fn(async () => undefined),
      observe: vi.fn(),
      reset: vi.fn(),
      getSnapshot: vi.fn(() => null),
    };
    const fetchMock = vi.fn(async () =>
      response(200, {
        data: [{ assetid: "1" }, { assetid: "2" }],
        total: 2,
        limit: 2,
        offset: 0,
        sort: "newest",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pacedClient = new SteamWebApiMarketAssetsCatalogClient(
      new SteamWebApiFloatAssetsClient("test-api-key"),
      pacer as any,
    );

    await pacedClient.fetchCandidatePage(candidate, {
      limit: 2,
      offset: 0,
      sort: "newest",
      signal: controller.signal,
    });

    expect(pacer.acquire).toHaveBeenCalledOnce();
    expect(pacer.acquire).toHaveBeenCalledWith(controller.signal);
    expect(rateLimiter.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      pacer.acquire.mock.invocationCallOrder[0]!,
    );
    expect(pacer.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0]!,
    );
    expect(pacer.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "success",
        validAssets: 2,
        completedAt: expect.any(Number),
      }),
    );
    expect(pacer.observe).toHaveBeenCalledOnce();
  });

  it("clasifica HTTP 500 como congestión para que el pacer abra su gate", async () => {
    const pacer = {
      acquire: vi.fn(async () => undefined),
      observe: vi.fn(),
      reset: vi.fn(),
      getSnapshot: vi.fn(() => null),
    };
    vi.stubGlobal("fetch", vi.fn(async () => response(500, "upstream down")));
    const pacedClient = new SteamWebApiMarketAssetsCatalogClient(
      new SteamWebApiFloatAssetsClient("test-api-key"),
      pacer as any,
    );

    await expect(
      pacedClient.fetchCandidatePage(candidate, {
        limit: 10,
        offset: 0,
        sort: "newest",
      }),
    ).rejects.toMatchObject({ status: 500, kind: "retryable" });
    expect(pacer.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "server_error",
        validAssets: 0,
      }),
    );
  });

  it("clasifica un AbortSignal externo como cancelación, no como timeout", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                const error = new Error("request cancelled");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const request = createClient().fetchCandidatePage(candidate, {
      limit: 10,
      offset: 0,
      sort: "newest",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();

    await expect(request).rejects.toMatchObject({
      name: "MarketAssetsApiError",
      kind: "retryable",
      status: 0,
      quotaUnitsUsed: 10,
      httpAttempts: 1,
      failureKind: "cancelled",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(rateLimiter.penalize).not.toHaveBeenCalled();
  });

  it("cancela durante la espera de cuota sin inventar una request HTTP", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    rateLimiter.acquire.mockImplementationOnce(
      async (...args: any[]) =>
        new Promise<void>((_resolve, reject) => {
          const options = args[1] as { signal?: AbortSignal };
          options.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("cancelled while waiting");
              error.name = "FloatRateLimitAcquireCancelledError";
              reject(error);
            },
            { once: true },
          );
        }),
    );

    const request = createClient().fetchCandidatePage(candidate, {
      limit: 10,
      offset: 0,
      sort: "newest",
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(rateLimiter.acquire).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ signal: controller.signal }),
      ),
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({
      name: "MarketAssetsApiError",
      kind: "retryable",
      status: 0,
      quotaUnitsUsed: 0,
      httpAttempts: 0,
      failureKind: "cancelled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 402, 403])(
    "clasifica HTTP %i como fatal",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response(status, { error: `HTTP ${status}` })),
      );

      await expect(
        createClient().fetchCandidatePage(candidate, {
          limit: 10,
          offset: 0,
          sort: "newest",
        }),
      ).rejects.toMatchObject({
        name: "MarketAssetsApiError",
        kind: "fatal",
        status,
        quotaUnitsUsed: 10,
      });
    },
  );

  it("clasifica HTTP 404 como listing agotada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(404, { error: "not found" })),
    );

    await expect(
      createClient().fetchCandidatePage(candidate, {
        limit: 10,
        offset: 20,
        sort: "newest",
      }),
    ).resolves.toMatchObject({
      assets: [],
      providerTotal: 0,
      offset: 20,
      quotaUnitsUsed: 10,
    });
  });

  it("clasifica HTTP 429 como reintentable y penaliza el limitador", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(429, { error: "rate limited" })),
    );

    await expect(
      createClient().fetchCandidatePage(candidate, {
        limit: 10,
        offset: 0,
        sort: "newest",
      }),
    ).rejects.toMatchObject({
      name: "MarketAssetsApiError",
      kind: "retryable",
      status: 429,
      quotaUnitsUsed: 10,
    });
    expect(rateLimiter.penalize).toHaveBeenCalledTimes(1);
  });
});
