import { config } from "../config";

/** GET /market/youpin/prices — documentado en MCP steamwebapi (Market Prices). */
export const YOUPIN_MARKET_PRICES_URL =
  "https://www.steamwebapi.com/market/youpin/prices";

export interface YoupinMarketPriceRow {
  market_hash_name: string;
  price: number;
  quantity?: number;
  createdat?: string;
  variants?: Record<string, { price?: number; quantity?: number }> | null;
}

type PriceCatalog = Map<string, YoupinMarketPriceRow>;

let catalogCache: { fetchedAt: number; catalog: PriceCatalog } | null = null;

function encodeMarketHashName(name: string): string {
  return encodeURIComponent(name).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function variantPrice(
  row: YoupinMarketPriceRow,
  phase: string,
): number | null {
  if (!row.variants || typeof row.variants !== "object") return null;
  const target = normalizeKey(phase);
  for (const [key, data] of Object.entries(row.variants)) {
    if (normalizeKey(key) === target) {
      const price = Number(data?.price);
      if (price > 0) return price;
    }
  }
  return null;
}

export class SteamWebApiYoupinPricesClient {
  constructor(
    private apiKey = config.steamwebapiApiKey,
    private currency = config.youpinPrices.currency,
    private cacheTtlMs = config.youpinPrices.cacheTtlMs,
  ) {}

  async fetchCatalog(forceRefresh = false): Promise<PriceCatalog> {
    if (
      !forceRefresh &&
      catalogCache &&
      Date.now() - catalogCache.fetchedAt < this.cacheTtlMs
    ) {
      return catalogCache.catalog;
    }

    if (!this.apiKey) {
      console.warn(
        "[YouPin Prices] STEAMWEBAPI_API_KEY no configurado; catálogo vacío.",
      );
      return new Map();
    }

    const params = new URLSearchParams({
      key: this.apiKey,
      currency: this.currency,
    });
    const url = `${YOUPIN_MARKET_PRICES_URL}?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[YouPin Prices] GET /market/youpin/prices HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
      return catalogCache?.catalog ?? new Map();
    }

    const rows = (await res.json()) as YoupinMarketPriceRow[];
    const catalog = new Map<string, YoupinMarketPriceRow>();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row?.market_hash_name) continue;
        catalog.set(row.market_hash_name, row);
      }
    }

    catalogCache = { fetchedAt: Date.now(), catalog };
    console.log(
      `[YouPin Prices] Catálogo YouPin cargado: ${catalog.size} ítems (currency=${this.currency}).`,
    );
    return catalog;
  }

  /** Consulta puntual: GET /market/youpin/prices?market_hash_name=... */
  async fetchPriceByMarketHashName(marketHashName: string): Promise<number | null> {
    if (!this.apiKey || !marketHashName) return null;

    const params = new URLSearchParams({
      key: this.apiKey,
      currency: this.currency,
      market_hash_name: marketHashName,
    });
    const url = `${YOUPIN_MARKET_PRICES_URL}?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) {
      return null;
    }

    const rows = (await res.json()) as YoupinMarketPriceRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const row = rows.find(
      (r) => normalizeKey(r.market_hash_name) === normalizeKey(marketHashName),
    ) ?? rows[0];
    if (!row) return null;

    const price = Number(row.price);
    return price > 0 ? price : null;
  }

  resolvePriceFromCatalog(
    itemName: string,
    catalog: PriceCatalog,
    getBaseNameAndPhase: (name: string) => { baseName: string; phase: string | null },
  ): number | null {
    if (!itemName) return null;

    const tryName = (name: string): number | null => {
      const row = catalog.get(name);
      if (!row) return null;
      const price = Number(row.price);
      return price > 0 ? price : null;
    };

    let price = tryName(itemName);
    if (price != null) return price;

    if (itemName.startsWith("Sticker | ")) {
      price = tryName(itemName.replace("Sticker | ", "Sticker Slab | "));
      if (price != null) return price;
    } else if (itemName.startsWith("Sticker Slab | ")) {
      price = tryName(itemName.replace("Sticker Slab | ", "Sticker | "));
      if (price != null) return price;
    }

    const { baseName, phase } = getBaseNameAndPhase(itemName);
    if (phase && baseName) {
      const baseRow = catalog.get(baseName);
      if (baseRow) {
        const variant = variantPrice(baseRow, phase);
        if (variant != null) return variant;
      }
    }

    return null;
  }

  /** Invalida cache en memoria (p. ej. tras sync-prices forzado). */
  static clearCache(): void {
    catalogCache = null;
  }
}

export function encodeYoupinMarketHashName(name: string): string {
  return encodeMarketHashName(name);
}
