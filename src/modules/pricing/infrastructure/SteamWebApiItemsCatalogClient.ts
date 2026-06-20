import { config } from "../../../shared/config";
import type {
  SteamWebApiItemsCatalogRow,
  SteamWebApiItemsCatalogSnapshot,
} from "../domain/types";

export const STEAMWEBAPI_ITEMS_CATALOG_URL =
  "https://www.steamwebapi.com/steam/api/items";

export interface FetchItemsCatalogOptions {
  forceRefresh?: boolean;
}

export interface FetchItemsCatalogResult {
  ok: boolean;
  snapshot: SteamWebApiItemsCatalogSnapshot | null;
  status: number;
  errors: string[];
}

function rowsFromPayload(payload: unknown): SteamWebApiItemsCatalogRow[] {
  if (Array.isArray(payload)) return payload as SteamWebApiItemsCatalogRow[];
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: SteamWebApiItemsCatalogRow[] }).data;
  }
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { items?: unknown }).items)
  ) {
    return (payload as { items: SteamWebApiItemsCatalogRow[] }).items;
  }
  return [];
}

export class SteamWebApiItemsCatalogClient {
  constructor(
    private apiKey = "",
    private market = config.itemsCatalog.market,
    private currency = config.itemsCatalog.currency,
    private pageSize = config.itemsCatalog.pageSize,
    private maxPages = config.itemsCatalog.maxPages,
    private select = config.itemsCatalog.select,
  ) {}

  async fetchCatalog(
    _options: FetchItemsCatalogOptions = {},
  ): Promise<FetchItemsCatalogResult> {
    const apiKey = this.apiKey || config.steamwebapiApiKey;
    if (!apiKey) {
      return {
        ok: false,
        snapshot: null,
        status: 0,
        errors: ["STEAMWEBAPI_API_KEY no configurado"],
      };
    }

    const items: SteamWebApiItemsCatalogRow[] = [];
    const errors: string[] = [];
    let lastStatus = 200;
    let pageCount = 0;

    for (let page = 1; page <= this.maxPages; page++) {
      const params = new URLSearchParams({
        key: apiKey,
        game: "cs2",
        page: String(page),
        max: String(this.pageSize),
        currency: this.currency,
        production: "1",
        select: this.select,
      });
      if (this.market) {
        params.set("markets", this.market);
      }

      const url = `${STEAMWEBAPI_ITEMS_CATALOG_URL}?${params.toString()}`;
      const res = await fetch(url);
      lastStatus = res.status;

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        errors.push(
          `Página ${page}: HTTP ${res.status} ${this.extractErrorMessage(body)}`,
        );
        break;
      }

      const rows = rowsFromPayload(await res.json());
      if (rows.length === 0) {
        break;
      }

      pageCount = page;
      items.push(...rows);

      if (rows.length < this.pageSize) {
        break;
      }
    }

    if (items.length === 0) {
      return {
        ok: false,
        snapshot: null,
        status: lastStatus,
        errors: errors.length ? errors : ["El catálogo no devolvió items"],
      };
    }

    const sourceParams = new URLSearchParams({
      game: "cs2",
      max: String(this.pageSize),
      currency: this.currency,
      production: "1",
      select: this.select,
    });
    if (this.market) sourceParams.set("markets", this.market);

    return {
      ok: errors.length === 0,
      status: lastStatus,
      errors,
      snapshot: {
        fetchedAt: new Date().toISOString(),
        currency: this.currency,
        market: this.market,
        sourceUrl: `${STEAMWEBAPI_ITEMS_CATALOG_URL}?${sourceParams.toString()}`,
        pageCount,
        itemCount: items.length,
        errors,
        items,
      },
    };
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
