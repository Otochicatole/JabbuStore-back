import { config } from "../../../shared/config";
import type {
  SteamWebApiItemDetailsRow,
  SteamWebApiItemsPriceResult,
} from "../domain/types";

export const STEAMWEBAPI_ITEM_URL =
  "https://www.steamwebapi.com/steam/api/item";

let itemDetailsCache:
  | Map<string, { fetchedAt: number; result: SteamWebApiItemsPriceResult }>
  | null = null;

function normalizeCacheKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export class SteamWebApiItemsPricesClient {
  constructor(
    private apiKey = "",
    private market = config.itemsPrices.market,
    private currency = config.itemsPrices.currency,
    private cacheTtlMs = config.itemsPrices.cacheTtlMs,
  ) {
    itemDetailsCache ??= new Map();
  }

  async fetchItemDetails(
    baseMarketHashName: string,
    forceRefresh = false,
  ): Promise<SteamWebApiItemsPriceResult> {
    const key = normalizeCacheKey(baseMarketHashName);
    const cache = itemDetailsCache ?? new Map();
    itemDetailsCache = cache;

    const cached = cache.get(key);
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.fetchedAt < this.cacheTtlMs
    ) {
      return cached.result;
    }

    const apiKey = this.apiKey || config.steamwebapiApiKey;
    if (!apiKey || !baseMarketHashName) {
      return {
        item: cached?.result.item ?? null,
        ok: Boolean(cached?.result.item),
        status: 0,
        error: "STEAMWEBAPI_API_KEY no configurado o market_hash_name vacío",
      };
    }

    const params = new URLSearchParams({
      key: apiKey,
      market_hash_name: baseMarketHashName,
      currency: this.currency,
      with_groups: "true",
      markets: this.market,
      production: "1",
    });

    const res = await fetch(`${STEAMWEBAPI_ITEM_URL}?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = this.extractErrorMessage(body);
      const result: SteamWebApiItemsPriceResult = {
        item: cached?.result.item ?? null,
        ok: Boolean(cached?.result.item),
        status: res.status,
        error,
      };
      if (result.item) {
        console.warn(
          `[Items Prices] GET /steam/api/item HTTP ${res.status}; usando cache para "${baseMarketHashName}". ${error}`,
        );
      } else {
        console.warn(
          `[Items Prices] GET /steam/api/item HTTP ${res.status} para "${baseMarketHashName}": ${error}`,
        );
      }
      return result;
    }

    const payload = (await res.json()) as SteamWebApiItemDetailsRow;
    const hasPrice =
      isPositiveNumber(payload?.pricereal) ||
      isPositiveNumber(payload?.pricemix) ||
      isPositiveNumber(payload?.pricelatest) ||
      (Array.isArray(payload?.variants) &&
        payload.variants.some(
          (variant) =>
            isPositiveNumber(variant.pricereal) ||
            isPositiveNumber(variant.pricemix) ||
            isPositiveNumber(variant.pricelatest),
        ));

    const result: SteamWebApiItemsPriceResult = {
      item: payload ?? null,
      ok: Boolean(payload) && hasPrice,
      status: res.status,
      ...(hasPrice ? {} : { error: "Respuesta sin precio utilizable" }),
    };

    if (result.ok) {
      cache.set(key, { fetchedAt: Date.now(), result });
    }

    return result;
  }

  clearCache(): void {
    itemDetailsCache?.clear();
  }

  static clearCache(): void {
    itemDetailsCache?.clear();
  }

  private extractErrorMessage(body: string): string {
    if (!body) return "Sin cuerpo de respuesta";
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string };
      return parsed.message || parsed.error || body.slice(0, 300);
    } catch {
      return body.slice(0, 300);
    }
  }
}
