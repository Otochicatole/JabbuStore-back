import { config } from "../../../shared/config";
import type { MarketAssetsRequestOutcome } from "../application/IMarketAssetsCatalogClient";
import {
  FloatRateLimitAcquireCancelledError,
  floatRateLimiter,
  type FloatRateLimitPriority,
  type FloatRateLimitSnapshot,
} from "../application/FloatRateLimiter";
import { marketSyncProgressService } from "../application/MarketSyncProgressService";

/** GET /steam/api/float/assets (sin API key en constantes/logs). */
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
  rateLimitPriority?: FloatRateLimitPriority;
  maxRateLimitWaitMs?: number;
  onRateLimitWait?: (waitMs: number) => void;
  /**
   * Admission hook ejecutado cuando la ventana parece disponible. Al volver,
   * el limitador revalida y reserva cuota en la ventana vigente justo antes
   * del HTTP, evitando liberar decenas de requests al mismo tiempo.
   */
  beforePhysicalRequest?: () => Promise<void>;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
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
  quotaUnitsUsed: number;
  creditsUsed: number;
  rateLimit: FloatRateLimitSnapshot;
  durationMs: number;
  outcome: MarketAssetsRequestOutcome;
  /** Requests que llegaron a invocar `fetch`; una cancelación en cuota vale 0. */
  httpAttempts: number;
}

export function parseFloatAssetsResponse(parsed: any): {
  assets: any[];
  total: number;
  limit: number;
  offset: number;
  sort: string;
  creditsUsed: number;
} {
  if (Array.isArray(parsed)) {
    return {
      assets: parsed,
      total: parsed.length,
      limit: parsed.length,
      offset: 0,
      sort: "newest",
      creditsUsed: 0,
    };
  }

  const assets = Array.isArray(parsed?.data) ? parsed.data : [];
  const creditsUsed = Number(parsed?.credits_used);
  return {
    assets,
    total: Math.max(0, Number(parsed?.total) || assets.length),
    limit: Math.max(0, Number(parsed?.limit) || assets.length),
    offset: Math.max(0, Number(parsed?.offset) || 0),
    sort: String(parsed?.sort ?? "newest"),
    creditsUsed:
      Number.isFinite(creditsUsed) && creditsUsed >= 0 ? creditsUsed : 0,
  };
}

function readRateLimitHeaders(res: Response) {
  const first = (...names: string[]): string | null => {
    for (const name of names) {
      const value = res.headers.get(name);
      if (value != null) return value;
    }
    return null;
  };

  return {
    limit: first("x-ratelimit-limit", "ratelimit-limit"),
    remaining: first("x-ratelimit-remaining", "ratelimit-remaining"),
    reset: first("x-ratelimit-reset", "ratelimit-reset"),
    retryAfter: first("retry-after"),
  };
}

function defaultTimeoutMs(): number {
  const value = Number(process.env.FLOAT_SYNC_REQUEST_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 30_000;
}

function maxResponseBytes(): number {
  const value = Number(process.env.MARKET_ASSETS_MAX_RESPONSE_BYTES);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 8_000_000;
}

function emptyPage(input: {
  limit: number;
  offset: number;
  sort: string;
  status: number;
  error: string;
  rateLimited?: boolean;
  quotaUnitsUsed: number;
  durationMs?: number;
  outcome?: MarketAssetsRequestOutcome;
  httpAttempts?: number;
}): FloatAssetsPage {
  return {
    assets: [],
    total: 0,
    limit: input.limit,
    offset: input.offset,
    sort: input.sort,
    ok: false,
    status: input.status,
    error: input.error,
    rateLimited: input.rateLimited ?? false,
    rowsUsed: input.quotaUnitsUsed,
    quotaUnitsUsed: input.quotaUnitsUsed,
    creditsUsed: 0,
    rateLimit: floatRateLimiter.getSnapshot(),
    durationMs: input.durationMs ?? 0,
    httpAttempts: input.httpAttempts ?? 1,
    outcome:
      input.outcome ??
      (input.status === 404
        ? "not_found"
        : input.status === 429
          ? "rate_limited"
          : input.status === 0
            ? "network"
            : input.status === 408 ||
                input.status === 425 ||
                input.status >= 500
              ? "http_transient"
              : "fatal"),
  };
}

export class SteamWebApiFloatAssetsClient {
  constructor(private readonly apiKey = "") {}

  async fetchPage(query: FloatAssetsQuery): Promise<FloatAssetsPage> {
    const apiKey = this.apiKey || config.steamwebapiApiKey;
    const limit = Math.max(1, Math.trunc(query.limit ?? 10));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const sort = query.sort ?? "newest";

    if (!apiKey) {
      return emptyPage({
        limit,
        offset,
        sort,
        status: 0,
        error: "STEAMWEBAPI_API_KEY no configurado",
        quotaUnitsUsed: 0,
        httpAttempts: 0,
      });
    }

    const params = new URLSearchParams({
      key: apiKey,
      limit: String(limit),
      offset: String(offset),
      sort,
    });
    if (query.source) params.set("source", query.source);
    if (query.onlyMarketId !== undefined) {
      params.set("only_market_id", query.onlyMarketId ? "1" : "0");
    }
    if (query.withItems !== undefined) {
      params.set("with_items", query.withItems ? "1" : "0");
    }
    if (query.marketHashName) {
      params.set("market_hash_name", query.marketHashName);
    }
    if (query.paintIndex != null) {
      params.set("paint_index", String(query.paintIndex));
    }
    if (query.wear) params.set("wear", query.wear);
    if (query.phase) params.set("phase", query.phase);
    if (query.defIndex != null) params.set("def_index", String(query.defIndex));
    if (query.isStatTrak !== undefined) {
      params.set("is_stattrak", query.isStatTrak ? "1" : "0");
    }
    if (query.isSouvenir !== undefined) {
      params.set("is_souvenir", query.isSouvenir ? "1" : "0");
    }

    try {
      await floatRateLimiter.acquire(limit, {
        priority: query.rateLimitPriority ?? "normal",
        ...(query.maxRateLimitWaitMs != null
          ? { maxWaitMs: query.maxRateLimitWaitMs }
          : {}),
        ...(query.onRateLimitWait
          ? { onWait: query.onRateLimitWait }
          : {}),
        ...(query.beforePhysicalRequest
          ? { beforeReserve: query.beforePhysicalRequest }
          : {}),
        ...(query.signal ? { signal: query.signal } : {}),
      });
    } catch (error) {
      if (
        error instanceof FloatRateLimitAcquireCancelledError ||
        query.signal?.aborted
      ) {
        return emptyPage({
          limit,
          offset,
          sort,
          status: 0,
          error: "Consulta float/assets cancelada durante la espera de cuota",
          quotaUnitsUsed: 0,
          outcome: "cancelled",
          httpAttempts: 0,
        });
      }
      throw error;
    }

    const controller = new AbortController();
    const requestSignal = query.signal
      ? AbortSignal.any([controller.signal, query.signal])
      : controller.signal;
    const timeout = setTimeout(
      () => controller.abort(),
      query.requestTimeoutMs ?? defaultTimeoutMs(),
    );
    const requestStartedAt = Date.now();
    try {
      const res = await fetch(
        `${STEAM_FLOAT_ASSETS_URL}?${params.toString()}`,
        {
          signal: requestSignal,
          headers: { accept: "application/json" },
        },
      );

      const rateHeaders = readRateLimitHeaders(res);
      if (res.status === 429) {
        await floatRateLimiter.penalize(rateHeaders);
      } else {
        await floatRateLimiter.observeHeaders(rateHeaders);
      }

      const advertisedLength = Number(res.headers.get("content-length"));
      if (
        Number.isFinite(advertisedLength) &&
        advertisedLength > maxResponseBytes()
      ) {
        return emptyPage({
          limit,
          offset,
          sort,
          status: res.status,
          error: `Respuesta float/assets demasiado grande (${advertisedLength} bytes)`,
          rateLimited: res.status === 429,
          quotaUnitsUsed: limit,
          durationMs: Date.now() - requestStartedAt,
          outcome: "fatal",
        });
      }

      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength > maxResponseBytes()) {
        return emptyPage({
          limit,
          offset,
          sort,
          status: res.status,
          error: `Respuesta float/assets demasiado grande (${bytes.byteLength} bytes)`,
          rateLimited: res.status === 429,
          quotaUnitsUsed: limit,
          durationMs: Date.now() - requestStartedAt,
          outcome: "fatal",
        });
      }
      const body = bytes.toString("utf8");

      if (!res.ok) {
        return emptyPage({
          limit,
          offset,
          sort,
          status: res.status,
          error: body.slice(0, 500) || `HTTP ${res.status}`,
          rateLimited: res.status === 429,
          quotaUnitsUsed: limit,
          durationMs: Date.now() - requestStartedAt,
        });
      }

      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        return emptyPage({
          limit,
          offset,
          sort,
          status: res.status,
          error: "SteamWebAPI devolvió JSON inválido",
          quotaUnitsUsed: limit,
          durationMs: Date.now() - requestStartedAt,
          // Un body truncado o una respuesta temporal del upstream no cambia
          // el contrato de nuestra consulta y puede recuperarse serialmente.
          outcome: "http_transient",
        });
      }

      const page = parseFloatAssetsResponse(parsed);
      return {
        ...page,
        ok: true,
        status: res.status,
        error: null,
        rateLimited: false,
        rowsUsed: limit,
        quotaUnitsUsed: limit,
        rateLimit: floatRateLimiter.getSnapshot(),
        durationMs: Date.now() - requestStartedAt,
        outcome: page.assets.length > 0 ? "success" : "success_empty",
        httpAttempts: 1,
      };
    } catch (error) {
      const externallyCancelled = Boolean(
        query.signal?.aborted && !controller.signal.aborted,
      );
      const timedOut =
        !externallyCancelled &&
        (controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError"));
      return emptyPage({
        limit,
        offset,
        sort,
        status: 0,
        error: externallyCancelled
          ? "Consulta float/assets cancelada porque el objetivo ya fue alcanzado"
          : timedOut
          ? "SteamWebAPI float/assets agotó el tiempo de espera"
          : error instanceof Error
            ? error.message
            : String(error),
        quotaUnitsUsed: limit,
        durationMs: Date.now() - requestStartedAt,
        outcome: externallyCancelled
          ? "cancelled"
          : timedOut
            ? "timeout"
            : "network",
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Legacy/diagnóstico: catálogo general no priorizado. */
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
        rateLimitPriority: "sync",
      });
      rowsUsed += result.rowsUsed;
      if (result.rateLimited) {
        rateLimited = true;
        break;
      }
      if (!result.ok || result.assets.length === 0) break;
      all.push(...result.assets);
      if ((page + 1) * pageSize >= result.total) break;
    }

    return { assets: all, rowsUsed, rateLimited };
  }
}
