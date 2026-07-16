import { config } from "../../../shared/config";
import { floatRateLimiter } from "../application/FloatRateLimiter";
import { marketSyncProgressService } from "../application/MarketSyncProgressService";

/** Documentado en MCP steamwebapi: GET /steam/api/float/assets */
export const STEAM_FLOAT_ASSETS_URL =
  "https://www.steamwebapi.com/steam/api/float/assets";

export type FloatAssetsSort =
  | "newest"
  | "oldest"
  | "lowest_float"
  | "highest_float";

export interface FloatAssetsQuery {
  source?: "youpin" | "csfloat";
  marketHashName?: string;
  limit?: number;
  offset?: number;
  sort?: FloatAssetsSort;
  onlyMarketId?: boolean;
  withItems?: boolean;
  paintIndex?: number;
  wear?: string;
  phase?: string;
  defIndex?: number;
  isStatTrak?: boolean;
  isSouvenir?: boolean;
}

export interface FloatAssetsPage {
  assets: any[];
  total: number;
  limit: number;
  offset: number;
  sort: string;
  ok: boolean;
  status: number;
  error: string | null;
  rateLimited: boolean;
  rowsUsed: number;
}

export function parseFloatAssetsResponse(parsed: any): {
  assets: any[];
  total: number;
  limit: number;
  offset: number;
  sort: string;
} {
  if (Array.isArray(parsed)) {
    return {
      assets: parsed,
      total: parsed.length,
      limit: parsed.length,
      offset: 0,
      sort: "newest",
    };
  }

  const assets = Array.isArray(parsed?.data) ? parsed.data : [];
  return {
    assets,
    total: Number(parsed?.total) || assets.length,
    limit: Number(parsed?.limit) || assets.length,
    offset: Number(parsed?.offset) || 0,
    sort: String(parsed?.sort ?? "newest"),
  };
}

export class SteamWebApiFloatAssetsClient {
  constructor(private apiKey = "") {}

  async fetchPage(query: FloatAssetsQuery): Promise<FloatAssetsPage> {
    const apiKey = this.apiKey || config.steamwebapiApiKey;
    if (!apiKey) {
      return {
        assets: [],
        total: 0,
        limit: query.limit ?? 10,
        offset: query.offset ?? 0,
        sort: query.sort ?? "newest",
        ok: false,
        status: 0,
        error: "STEAMWEBAPI_API_KEY no configurado",
        rateLimited: false,
        rowsUsed: 0,
      };
    }

    const limit = query.limit ?? 10;
    const offset = query.offset ?? 0;
    const params = new URLSearchParams({
      key: apiKey,
      appid: "730",
      limit: String(limit),
      offset: String(offset),
      sort: query.sort ?? "newest",
    });

    if (query.source) params.set("source", query.source);
    if (query.onlyMarketId !== false) params.set("only_market_id", "1");
    if (query.withItems) params.set("with_items", "1");
    if (query.marketHashName) params.set("market_hash_name", query.marketHashName);
    if (query.paintIndex != null) params.set("paint_index", String(query.paintIndex));
    if (query.wear) params.set("wear", query.wear);
    if (query.phase) params.set("phase", query.phase);
    if (query.defIndex != null) params.set("def_index", String(query.defIndex));
    if (query.isStatTrak) params.set("is_stattrak", "1");
    if (query.isSouvenir) params.set("is_souvenir", "1");

    await floatRateLimiter.acquire(limit);

    const res = await fetch(`${STEAM_FLOAT_ASSETS_URL}?${params.toString()}`);
    floatRateLimiter.observeRemaining(res.headers.get("x-ratelimit-remaining"));

    if (res.status === 429) {
      floatRateLimiter.penalize();
      return {
        assets: [],
        total: 0,
        limit,
        offset,
        sort: query.sort ?? "newest",
        ok: false,
        status: res.status,
        error: "Rate limit exceeded",
        rateLimited: true,
        rowsUsed: limit,
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        assets: [],
        total: 0,
        limit,
        offset,
        sort: query.sort ?? "newest",
        ok: false,
        status: res.status,
        error: body.slice(0, 300) || `HTTP ${res.status}`,
        rateLimited: false,
        rowsUsed: limit,
      };
    }

    const parsed = await res.json();
    const page = parseFloatAssetsResponse(parsed);

    return {
      ...page,
      ok: true,
      status: res.status,
      error: null,
      rateLimited: false,
      rowsUsed: limit,
    };
  }

  /** Sin market_hash_name devuelve múltiples skins YouPin, cada una con float concreto. */
  async fetchYoupinCatalogPages(options: {
    pageSize?: number;
    maxPages?: number;
    sort?: FloatAssetsSort;
    withItems?: boolean;
  }): Promise<{ assets: any[]; rowsUsed: number; rateLimited: boolean }> {
    const pageSize = options.pageSize ?? config.marketSync.pageSize;
    const maxPages = options.maxPages ?? config.marketSync.maxPages;
    const all: any[] = [];
    let rowsUsed = 0;
    let rateLimited = false;

    for (let page = 0; page < maxPages; page++) {
      marketSyncProgressService.updateFetchPage(page + 1, all.length);
      const result = await this.fetchPage({
        source: "youpin",
        onlyMarketId: true,
        withItems: options.withItems ?? true,
        limit: pageSize,
        offset: page * pageSize,
        sort: options.sort ?? "newest",
      });

      rowsUsed += result.rowsUsed;
      if (result.rateLimited) {
        rateLimited = true;
        break;
      }
      if (result.assets.length === 0) break;

      all.push(...result.assets);

      if ((page + 1) * pageSize >= result.total) break;
    }

    return { assets: all, rowsUsed, rateLimited };
  }
}
