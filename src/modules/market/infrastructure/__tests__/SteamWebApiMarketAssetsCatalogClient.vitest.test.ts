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
}));

import type { MarketAssetsPriorityCandidate } from "../../application/MarketAssetsPriorityQueue";
import { SteamWebApiFloatAssetsClient } from "../SteamWebApiFloatAssetsClient";
import { SteamWebApiMarketAssetsCatalogClient } from "../SteamWebApiMarketAssetsCatalogClient";

const candidate: MarketAssetsPriorityCandidate = {
  key: "ak-redline-field-tested",
  marketHashName: "AK-47 | Redline (Field-Tested)",
  queryMarketHashName: "AK-47 | Redline (Field-Tested)",
  priorityPrice: 300,
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
    { maxAttempts: 1, retryBaseDelayMs: 0 },
  );
}

describe("SteamWebApiMarketAssetsCatalogClient", () => {
  beforeEach(() => {
    rateLimiter.acquire.mockClear();
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

  it("combina market_hash_name con los filtros exactos de una fase Doppler", async () => {
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
    expect(requestUrl.searchParams.get("phase")).toBe("black-pearl");
    expect(requestUrl.searchParams.get("def_index")).toBe("515");
    expect(requestUrl.searchParams.get("wear")).toBe("FN");
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
