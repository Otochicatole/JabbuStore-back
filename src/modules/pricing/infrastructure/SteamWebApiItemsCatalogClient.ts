import { config } from "../../../shared/config";
import type {
  SteamWebApiItemsCatalogRow,
  SteamWebApiItemsCatalogSnapshot,
} from "../domain/types";

export const STEAMWEBAPI_ITEMS_CATALOG_URL =
  "https://www.steamwebapi.com/steam/api/items";

export interface FetchItemsCatalogOptions {
  forceRefresh?: boolean;
  onProgress?: (progress: {
    currentPage: number;
    totalPages: number;
    itemCount: number;
  }) => void;
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
    options: FetchItemsCatalogOptions = {},
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
    let complete = false;

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
        complete = true;
        options.onProgress?.({
          currentPage: page,
          totalPages: this.maxPages,
          itemCount: items.length,
        });
        break;
      }

      pageCount = page;
      items.push(...rows);
      options.onProgress?.({
        currentPage: page,
        totalPages: this.maxPages,
        itemCount: items.length,
      });

      if (rows.length < this.pageSize) {
        complete = true;
        break;
      }
    }

    if (!complete && errors.length === 0) {
      errors.push(
        `El catálogo alcanzó ITEMS_CATALOG_MAX_PAGES=${this.maxPages} sin confirmar el final`,
      );
    }

    if (items.length === 0) {
      return {
        ok: false,
        snapshot: null,
        status: lastStatus,
        errors: errors.length ? errors : ["El catálogo no devolvió items"],
      };
    }

    if (
      complete &&
      errors.length === 0 &&
      this.market &&
      items.some(
        (row) =>
          Array.isArray(row.variants) &&
          row.variants.some((v) => v.pricereal == null || v.pricereal <= 0),
      )
    ) {
      await this.enrichMissingVariantPrices(apiKey, items);
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
      ok: complete && errors.length === 0,
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

  /**
   * Cuando `GET /steam/api/items` se consulta con `markets=youpin`, SteamWebAPI
   * filtra `variants[].pricereal` exclusivamente al mapa `variants` de YouPin.
   * Dado que el scraper de YouPin en SteamWebAPI no asigna `phase` a las gemas
   * (`Emerald`, `Ruby`, `Sapphire`, `Black Pearl` quedan con `pricereal: null`)
   * y en varias fases `Phase 1–4` devuelve `null`, enriquecemos únicamente las
   * variantes cuyo `pricereal` sea `null` con una consulta focalizada de items
   * Doppler sin filtro `markets`, preservando el precio de YouPin siempre que exista.
   */
  private async enrichMissingVariantPrices(
    apiKey: string,
    items: SteamWebApiItemsCatalogRow[],
  ): Promise<void> {
    try {
      const params = new URLSearchParams({
        key: apiKey,
        game: "cs2",
        search: "Doppler",
        max: "500",
        currency: this.currency,
        production: "1",
        select: "markethashname,marketname,normalizedname,variants",
      });
      const res = await fetch(`${STEAMWEBAPI_ITEMS_CATALOG_URL}?${params.toString()}`);
      if (!res.ok) return;

      const fallbackRows = rowsFromPayload(await res.json());
      const fallbackByName = new Map<string, SteamWebApiItemsCatalogRow>();
      for (const row of fallbackRows) {
        const key = (
          row.markethashname ??
          row.market_hash_name ??
          row.marketname ??
          row.normalizedname ??
          ""
        ).trim();
        if (key) fallbackByName.set(key, row);
      }

      for (const item of items) {
        if (!Array.isArray(item.variants) || item.variants.length === 0) continue;
        const key = (
          item.markethashname ??
          item.market_hash_name ??
          item.marketname ??
          item.normalizedname ??
          ""
        ).trim();
        const fallbackRow = key ? fallbackByName.get(key) : undefined;
        if (!fallbackRow || !Array.isArray(fallbackRow.variants)) continue;

        for (const variant of item.variants) {
          if (typeof variant.pricereal === "number" && variant.pricereal > 0) {
            continue;
          }
          const vPaint = variant.paintindex ?? variant.paint_index;
          const vPhase = variant.phase?.trim().toLowerCase();
          const match = fallbackRow.variants.find((candidate) => {
            const cPaint = candidate.paintindex ?? candidate.paint_index;
            if (vPaint != null && cPaint != null && vPaint === cPaint) return true;
            return Boolean(
              vPhase &&
                candidate.phase &&
                candidate.phase.trim().toLowerCase() === vPhase,
            );
          });
          if (
            match &&
            typeof match.pricereal === "number" &&
            Number.isFinite(match.pricereal) &&
            match.pricereal > 0
          ) {
            variant.pricereal = match.pricereal;
          }
        }
      }
    } catch (err) {
      console.warn(
        "[SteamWebApiItemsCatalogClient] No se pudo enriquecer precios de variantes Doppler:",
        err,
      );
    }
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
