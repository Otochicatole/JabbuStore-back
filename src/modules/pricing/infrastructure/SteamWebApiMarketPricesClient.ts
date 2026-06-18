import { config } from "../../../shared/config";
import type {
  BotPriceCatalogBundle,
  BotPriceCatalogFetchResult,
  PriceCatalog,
  SteamWebApiMarketsPriceRow,
  SteamWebApiYoupinPriceRow,
} from "../domain/types";

/**
 * Cliente SteamWebAPI — Market Prices (bots).
 *
 * Bulk (sin rate limit puntual):
 * - GET /market/youpin/prices
 * - GET /market/buff/prices
 */
export const YOUPIN_MARKET_PRICES_URL =
  "https://www.steamwebapi.com/market/youpin/prices";

export const BUFF_MARKET_PRICES_URL =
  "https://www.steamwebapi.com/market/buff/prices";

export const MARKETS_PRICES_URL =
  "https://www.steamwebapi.com/markets/prices";

let bundleCache: { fetchedAt: number; bundle: BotPriceCatalogBundle } | null =
  null;

/** Rate limit consultas puntuales (~2 req/min plan Items). El bulk no consume este slot. */
let lastPointLookupAt = 0;
const POINT_LOOKUP_GAP_MS = 31_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForPointLookupSlot(): Promise<void> {
  const elapsed = Date.now() - lastPointLookupAt;
  if (lastPointLookupAt > 0 && elapsed < POINT_LOOKUP_GAP_MS) {
    await sleep(POINT_LOOKUP_GAP_MS - elapsed);
  }
  lastPointLookupAt = Date.now();
}

interface BulkFetchResult {
  catalog: PriceCatalog;
  ok: boolean;
  status: number;
  error?: string;
}

function isUsableCatalog(catalog: PriceCatalog): boolean {
  return catalog.size > 0;
}

export class SteamWebApiMarketPricesClient {
  constructor(
    private apiKey = config.steamwebapiApiKey,
    private currency = config.youpinPrices.currency,
    private cacheTtlMs = config.youpinPrices.cacheTtlMs,
  ) {}

  /**
   * Catálogos bulk YouPin + Buff en paralelo.
   * Si la API falla (402, etc.), reutiliza cache stale en lugar de devolver catálogos vacíos.
   */
  async fetchBotPriceCatalogs(
    forceRefresh = false,
  ): Promise<BotPriceCatalogFetchResult> {
    const stale = bundleCache?.bundle;

    if (
      !forceRefresh &&
      bundleCache &&
      Date.now() - bundleCache.fetchedAt < this.cacheTtlMs
    ) {
      return {
        bundle: bundleCache.bundle,
        catalogAvailable: isUsableCatalog(bundleCache.bundle.youpin) ||
          isUsableCatalog(bundleCache.bundle.buff),
        errors: [],
      };
    }

    if (!this.apiKey) {
      const msg = "STEAMWEBAPI_API_KEY no configurado";
      console.warn(`[Market Prices] ${msg}`);
      return this.resultFromStaleOrEmpty(stale, [msg]);
    }

    const fetchBuff =
      config.botPrices.enableSecondaryMarkets &&
      config.botPrices.secondaryMarkets.some((m) => m === "buff");

    const [youpinRes, buffRes] = await Promise.all([
      this.fetchMarketCatalogBulk(YOUPIN_MARKET_PRICES_URL, "YouPin"),
      fetchBuff
        ? this.fetchMarketCatalogBulk(BUFF_MARKET_PRICES_URL, "Buff")
        : Promise.resolve({
            catalog: new Map<string, SteamWebApiYoupinPriceRow>(),
            ok: true,
            status: 200,
          } satisfies BulkFetchResult),
    ]);

    const errors: string[] = [];
    if (!youpinRes.ok) {
      errors.push(
        `YouPin HTTP ${youpinRes.status}: ${youpinRes.error ?? "error"}`,
      );
    }
    if (fetchBuff && !buffRes.ok) {
      errors.push(`Buff HTTP ${buffRes.status}: ${buffRes.error ?? "error"}`);
    }

    const youpin = youpinRes.ok
      ? youpinRes.catalog
      : (stale?.youpin ?? new Map<string, SteamWebApiYoupinPriceRow>());
    const buff = buffRes.ok
      ? buffRes.catalog
      : (stale?.buff ?? new Map<string, SteamWebApiYoupinPriceRow>());

    if (youpinRes.ok || buffRes.ok) {
      if (isUsableCatalog(youpin) || isUsableCatalog(buff)) {
        const bundle: BotPriceCatalogBundle = { youpin, buff };
        bundleCache = { fetchedAt: Date.now(), bundle };
        console.log(
          `[Market Prices] Catálogos bots — YouPin: ${youpin.size}, Buff: ${buff.size} filas (currency=${this.currency}).`,
        );
        return { bundle, catalogAvailable: true, errors };
      }
    }

    if (!youpinRes.ok && stale?.youpin.size) {
      console.warn(
        `[Market Prices] YouPin no disponible; usando cache (${stale.youpin.size} filas).`,
      );
    }
    if (fetchBuff && !buffRes.ok && stale?.buff.size) {
      console.warn(
        `[Market Prices] Buff no disponible; usando cache (${stale.buff.size} filas).`,
      );
    }

    const bundle: BotPriceCatalogBundle = {
      youpin: stale?.youpin ?? youpin,
      buff: stale?.buff ?? buff,
    };
    const catalogAvailable =
      isUsableCatalog(bundle.youpin) || isUsableCatalog(bundle.buff);

    if (!catalogAvailable) {
      console.error(
        `[Market Prices] Sin catálogo de precios utilizable. ${errors.join("; ")}`,
      );
    } else {
      console.log(
        `[Market Prices] Catálogos desde cache — YouPin: ${bundle.youpin.size}, Buff: ${bundle.buff.size}.`,
      );
    }

    return { bundle, catalogAvailable, errors };
  }

  private resultFromStaleOrEmpty(
    stale: BotPriceCatalogBundle | undefined,
    errors: string[],
  ): BotPriceCatalogFetchResult {
    const bundle = stale ?? { youpin: new Map(), buff: new Map() };
    return {
      bundle,
      catalogAvailable:
        isUsableCatalog(bundle.youpin) || isUsableCatalog(bundle.buff),
      errors,
    };
  }

  /** @deprecated Prefer fetchBotPriceCatalogs — devuelve solo YouPin del bundle. */
  async fetchYoupinCatalog(forceRefresh = false): Promise<PriceCatalog> {
    const result = await this.fetchBotPriceCatalogs(forceRefresh);
    return result.bundle.youpin;
  }

  /** Consulta puntual — GET /market/youpin/prices?market_hash_name=... */
  async fetchYoupinByMarketHashName(
    marketHashName: string,
  ): Promise<SteamWebApiYoupinPriceRow | null> {
    if (!this.apiKey || !marketHashName) return null;

    await waitForPointLookupSlot();

    const params = new URLSearchParams({
      key: this.apiKey,
      currency: this.currency,
      market_hash_name: marketHashName,
    });
    const res = await fetch(`${YOUPIN_MARKET_PRICES_URL}?${params.toString()}`);
    if (!res.ok) return null;

    const rows = (await res.json()) as SteamWebApiYoupinPriceRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0] ?? null;
  }

  async fetchMarketsPricesByMarketHashName(
    marketHashName: string,
    markets: string[],
  ): Promise<Map<string, SteamWebApiYoupinPriceRow>> {
    const result = new Map<string, SteamWebApiYoupinPriceRow>();
    if (!this.apiKey || !marketHashName || markets.length === 0) return result;

    await waitForPointLookupSlot();

    const params = new URLSearchParams({
      key: this.apiKey,
      currency: this.currency,
      market_hash_name: marketHashName,
      markets: markets.join(","),
    });
    const res = await fetch(`${MARKETS_PRICES_URL}?${params.toString()}`);
    if (!res.ok) return result;

    const rows = (await res.json()) as SteamWebApiMarketsPriceRow[];
    if (!Array.isArray(rows) || rows.length === 0) return result;

    const item = rows[0];
    if (!item?.market_hash_name || !item.prices) return result;

    for (const market of markets) {
      const slot = item.prices[market];
      if (!slot || slot.price <= 0) continue;
      result.set(market, {
        market_hash_name: item.market_hash_name,
        price: slot.price,
        ...(slot.quantity != null ? { quantity: slot.quantity } : {}),
        ...(slot.createdat ? { createdat: slot.createdat } : {}),
        variants: slot.variants ?? null,
      });
    }

    return result;
  }

  async fetchMarketsYoupinCatalog(forceRefresh = false): Promise<PriceCatalog> {
    const result = await this.fetchBotPriceCatalogs(forceRefresh);
    return result.bundle.youpin;
  }

  static clearCache(): void {
    bundleCache = null;
  }

  private async fetchMarketCatalogBulk(
    url: string,
    label: string,
  ): Promise<BulkFetchResult> {
    const params = new URLSearchParams({
      key: this.apiKey,
      currency: this.currency,
    });
    const res = await fetch(`${url}?${params.toString()}`);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let error = body.slice(0, 300);
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed.message) error = parsed.message;
      } catch {
        /* keep raw body */
      }
      console.warn(
        `[Market Prices] GET ${label} HTTP ${res.status}: ${error}`,
      );
      return { catalog: new Map(), ok: false, status: res.status, error };
    }

    const payload = await res.json();
    if (!Array.isArray(payload)) {
      const error = "Respuesta no es un array JSON";
      console.warn(`[Market Prices] GET ${label}: ${error}`);
      return { catalog: new Map(), ok: false, status: res.status, error };
    }

    const catalog = this.rowsToCatalog(payload as SteamWebApiYoupinPriceRow[]);
    if (catalog.size === 0) {
      return {
        catalog,
        ok: false,
        status: res.status,
        error: "Catálogo vacío",
      };
    }

    return { catalog, ok: true, status: res.status };
  }

  private rowsToCatalog(rows: SteamWebApiYoupinPriceRow[]): PriceCatalog {
    const catalog: PriceCatalog = new Map();
    if (!Array.isArray(rows)) return catalog;
    for (const row of rows) {
      if (!row?.market_hash_name) continue;
      catalog.set(row.market_hash_name, row);
    }
    return catalog;
  }
}
