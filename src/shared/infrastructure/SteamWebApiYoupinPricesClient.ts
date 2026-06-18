import { config } from "../config";

/** GET /market/youpin/prices — documentado en MCP steamwebapi (Market Prices). */
export const YOUPIN_MARKET_PRICES_URL =
  "https://www.steamwebapi.com/market/youpin/prices";

export type YoupinVariantValue =
  | number
  | { price?: number; quantity?: number };

export interface YoupinMarketPriceRow {
  market_hash_name: string;
  price: number;
  quantity?: number;
  createdat?: string;
  variants?: Record<string, YoupinVariantValue> | null;
}

type PriceCatalog = Map<string, YoupinMarketPriceRow>;

let catalogCache: { fetchedAt: number; catalog: PriceCatalog } | null = null;

function encodeMarketHashName(name: string): string {
  return encodeURIComponent(name).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function readVariantPrice(data: YoupinVariantValue | undefined): number | null {
  if (data == null) return null;
  if (typeof data === "number") {
    return data > 0 ? data : null;
  }
  const price = Number(data.price);
  return price > 0 ? price : null;
}

const PHASE_VARIANT_ALIASES: Record<string, string[]> = {
  "phase 1": ["phase 1", "p1", "phase1", "1"],
  "phase 2": ["phase 2", "p2", "phase2", "2"],
  "phase 3": ["phase 3", "p3", "phase3", "3"],
  "phase 4": ["phase 4", "p4", "phase4", "4"],
  ruby: ["ruby"],
  sapphire: ["sapphire"],
  "black pearl": ["black pearl", "blackpearl", "black-pearl"],
  emerald: ["emerald"],
};

function variantKeysForPhase(phase: string): Set<string> {
  const normalized = normalizeKey(phase);
  const keys = new Set<string>([normalized]);
  for (const aliases of Object.values(PHASE_VARIANT_ALIASES)) {
    if (aliases.some((a) => normalizeKey(a) === normalized)) {
      for (const alias of aliases) keys.add(normalizeKey(alias));
    }
  }
  if (PHASE_VARIANT_ALIASES[normalized]) {
    for (const alias of PHASE_VARIANT_ALIASES[normalized]) {
      keys.add(normalizeKey(alias));
    }
  }
  return keys;
}

function variantPrice(
  row: YoupinMarketPriceRow,
  phase: string,
): number | null {
  if (!row.variants || typeof row.variants !== "object") return null;

  const accepted = variantKeysForPhase(phase);
  for (const [key, data] of Object.entries(row.variants)) {
    if (accepted.has(normalizeKey(key))) {
      const price = readVariantPrice(data);
      if (price != null) return price;
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
  async fetchPriceByMarketHashName(
    marketHashName: string,
    getBaseNameAndPhase: (name: string) => { baseName: string; phase: string | null },
  ): Promise<number | null> {
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

    const tempCatalog = new Map<string, YoupinMarketPriceRow>();
    for (const row of rows) {
      if (row?.market_hash_name) {
        tempCatalog.set(row.market_hash_name, row);
      }
    }

    return this.resolvePriceForItem(
      marketHashName,
      tempCatalog,
      getBaseNameAndPhase,
    );
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

    const { baseName, phase } = getBaseNameAndPhase(itemName);

    if (phase && baseName) {
      const baseRow = catalog.get(baseName);
      if (baseRow) {
        const variant = variantPrice(baseRow, phase);
        if (variant != null) return variant;
      }
    }

    let price = tryName(itemName);
    if (price != null) return price;

    if (itemName.startsWith("Sticker | ")) {
      price = tryName(itemName.replace("Sticker | ", "Sticker Slab | "));
      if (price != null) return price;
    } else if (itemName.startsWith("Sticker Slab | ")) {
      price = tryName(itemName.replace("Sticker Slab | ", "Sticker | "));
      if (price != null) return price;
    }

    if (phase && baseName) {
      return null;
    }

    return null;
  }

  /**
   * Resuelve precio YouPin solo vía GET /market/youpin/prices (catálogo + variants).
   * Sin float/assets: el plan market es independiente del cupo de float.
   */
  resolvePriceForItem(
    itemName: string,
    catalog: PriceCatalog,
    getBaseNameAndPhase: (name: string) => { baseName: string; phase: string | null },
  ): number | null {
    const price = this.resolvePriceFromCatalog(itemName, catalog, getBaseNameAndPhase);
    if (price != null) return price;

    const { baseName, phase } = getBaseNameAndPhase(itemName);
    if (!phase || !baseName || !baseName.toLowerCase().includes("doppler")) {
      return null;
    }

    const baseRow = catalog.get(baseName);
    if (!baseRow) return null;

    const estimated = this.estimateDopplerPhasePrice(baseRow, phase);
    if (estimated != null) {
      console.log(
        `[YouPin Prices] Fase Doppler "${phase}" sin variant en catálogo para "${baseName}"; estimado: $${estimated}`,
      );
    }
    return estimated;
  }

  private isHighTierDopplerPhase(phase: string): boolean {
    return ["Ruby", "Sapphire", "Black Pearl", "Emerald"].includes(phase);
  }

  /**
   * Cuando /market/youpin/prices no trae variant para una fase concreta:
   * - Ruby/Sapphire/Black Pearl/Emerald: multiplicador sobre precio base del row.
   * - Phase 1–4: promedio de variants disponibles, o precio base del row.
   */
  private estimateDopplerPhasePrice(
    row: YoupinMarketPriceRow,
    phase: string,
  ): number | null {
    const basePrice = Number(row.price);
    if (basePrice <= 0) return null;

    if (this.isHighTierDopplerPhase(phase)) {
      return this.estimateHighTierDopplerPrice(basePrice, phase);
    }

    if (row.variants && typeof row.variants === "object") {
      const variantPrices: number[] = [];
      for (const data of Object.values(row.variants)) {
        const p = readVariantPrice(data);
        if (p != null) variantPrices.push(p);
      }
      if (variantPrices.length > 0) {
        const avg =
          variantPrices.reduce((sum, value) => sum + value, 0) /
          variantPrices.length;
        return Math.round(avg * 100) / 100;
      }
    }

    return basePrice;
  }

  private estimateHighTierDopplerPrice(basePrice: number, phase: string): number {
    const multipliers: Record<string, number> = {
      "Black Pearl": 8,
      Ruby: 9,
      Sapphire: 10,
      Emerald: 12,
    };
    const multiplier = multipliers[phase] ?? 1;
    return Math.round(basePrice * multiplier * 100) / 100;
  }

  /** Invalida cache en memoria (p. ej. tras sync-prices forzado). */
  static clearCache(): void {
    catalogCache = null;
  }
}

export function encodeYoupinMarketHashName(name: string): string {
  return encodeMarketHashName(name);
}
