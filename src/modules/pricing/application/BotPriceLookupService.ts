import type {
  BotPriceCatalogBundle,
  PriceCatalog,
  PriceLookupResult,
  PriceMarket,
  SteamWebApiItemsCatalogIndex,
  SteamWebApiItemsCatalogRow,
  SteamWebApiItemDetailsRow,
  SteamWebApiItemVariant,
  SteamWebApiYoupinPriceRow,
  YoupinVariantValue,
} from "../domain/types";
import type { SteamWebApiMarketPricesClient } from "../infrastructure/SteamWebApiMarketPricesClient";
import { DOPPLER_PHASE_DISPLAY, PAINT_INDEX_TO_PHASE } from "../domain/constants";
import { ItemVariantClassifier } from "./ItemVariantClassifier";
import { MarketHashNameNormalizer } from "./MarketHashNameNormalizer";

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function readVariantPrice(data: YoupinVariantValue | undefined): number | null {
  if (data == null) return null;
  if (typeof data === "number") return data > 0 ? data : null;
  const price = Number(data.price);
  return price > 0 ? price : null;
}

function readItemsApiPrice(
  data:
    | Pick<
        SteamWebApiItemDetailsRow,
        "pricereal" | "pricemix" | "pricelatest"
      >
    | Pick<SteamWebApiItemVariant, "pricereal" | "pricemix" | "pricelatest">
    | null
    | undefined,
): number | null {
  if (!data) return null;
  const price = Number(data.pricereal ?? data.pricemix ?? data.pricelatest);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function readCatalogRowPrice(row: SteamWebApiItemsCatalogRow | null | undefined): number | null {
  if (!row) return null;
  const price = Number(row.pricereal ?? row.pricemix ?? row.pricelatest);
  return Number.isFinite(price) && price > 0 ? price : null;
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

function phaseMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const accepted = variantKeysForPhase(a);
  return accepted.has(normalizeKey(b));
}

function variantPaintIndex(variant: SteamWebApiItemVariant): number | null {
  const value = variant.paintindex ?? variant.paint_index;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rowPaintIndex(row: SteamWebApiItemsCatalogRow): number | null {
  const value = row.paintindex;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function phaseForPaintIndex(paintIndex: number | null): string | null {
  if (paintIndex == null) return null;
  const key = PAINT_INDEX_TO_PHASE[paintIndex];
  return key ? DOPPLER_PHASE_DISPLAY[key] ?? key : null;
}

function variantPriceFromRow(
  row: SteamWebApiYoupinPriceRow,
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

export class BotPriceLookupService {
  constructor(
    private normalizer = new MarketHashNameNormalizer(),
    private classifier = new ItemVariantClassifier(),
  ) {}

  resolve(
    pricingMarketHashName: string,
    catalog: PriceCatalog,
    currency = "USD",
  ): PriceLookupResult {
    const classification = this.classifier.classify(pricingMarketHashName);

    const exact = this.tryExact(pricingMarketHashName, catalog);
    if (exact != null) {
      return this.buildResult(
        exact,
        pricingMarketHashName,
        null,
        "steamwebapi_market_exact",
        classification,
        true,
        currency,
      );
    }

    const stickerAlias = this.tryStickerAlias(pricingMarketHashName, catalog);
    if (stickerAlias != null) {
      return this.buildResult(
        stickerAlias.price,
        stickerAlias.key,
        null,
        "steamwebapi_market_exact",
        classification,
        true,
        currency,
      );
    }

    const { normalized } = classification;
    if (normalized.variantName) {
      const { baseName } = this.normalizer.splitDopplerPhase(
        this.normalizer.stripWear(pricingMarketHashName),
      );
      const baseRow = catalog.get(baseName);
      if (baseRow) {
        const variantPrice = variantPriceFromRow(baseRow, normalized.variantName);
        if (variantPrice != null) {
          return this.buildResult(
            variantPrice,
            baseName,
            normalized.variantName,
            "steamwebapi_market_variant",
            classification,
            true,
            currency,
          );
        }
        classification.warnings.push(
          `Fase "${normalized.variantName}" sin variant en catálogo YouPin para "${baseName}"`,
        );
      } else {
        classification.warnings.push(
          `Row base Doppler no encontrado en catálogo: "${baseName}"`,
        );
      }
    }

    return this.buildResult(
      null,
      pricingMarketHashName,
      normalized.variantName,
      "none",
      classification,
      false,
      currency,
    );
  }

  /**
   * Lookup bots: YouPin bulk primero; si no hay precio, Buff bulk (sin API puntual).
   */
  resolveForBots(
    pricingMarketHashName: string,
    catalogs: BotPriceCatalogBundle,
    currency = "USD",
  ): PriceLookupResult {
    const youpinResult = this.resolve(
      pricingMarketHashName,
      catalogs.youpin,
      currency,
    );
    if (youpinResult.price != null && youpinResult.price > 0) {
      return { ...youpinResult, market: "youpin" };
    }

    if (catalogs.buff.size > 0) {
      const buffResult = this.resolve(
        pricingMarketHashName,
        catalogs.buff,
        currency,
      );
      if (buffResult.price != null && buffResult.price > 0) {
        return {
          ...buffResult,
          market: "buff",
          source:
            buffResult.source === "steamwebapi_market_exact"
              ? "steamwebapi_secondary_exact"
              : buffResult.source === "steamwebapi_market_variant"
                ? "steamwebapi_secondary_variant"
                : buffResult.source,
        };
      }
    }

    return youpinResult;
  }

  resolveFromItemsApi(
    pricingMarketHashName: string,
    itemDetails: SteamWebApiItemDetailsRow | null,
    paintIndex?: number | null,
    currency = "USD",
  ): PriceLookupResult {
    const classification = this.classifier.classify(pricingMarketHashName);
    const { normalized } = classification;
    const { phase } = this.normalizer.splitDopplerPhase(pricingMarketHashName);
    const variantName = normalized.variantName ?? phase;

    if (!itemDetails) {
      return this.buildResult(
        null,
        pricingMarketHashName,
        variantName,
        "none",
        classification,
        false,
        currency,
      );
    }

    const itemName =
      itemDetails.markethashname ??
      itemDetails.market_hash_name ??
      itemDetails.marketname ??
      pricingMarketHashName;

    if (Array.isArray(itemDetails.variants) && itemDetails.variants.length > 0) {
      const byPaintIndex =
        paintIndex != null
          ? itemDetails.variants.find(
              (variant) => variantPaintIndex(variant) === paintIndex,
            )
          : undefined;
      const byPhase = variantName
        ? itemDetails.variants.find((variant) =>
            phaseMatches(variantName, variant.phase),
          )
        : undefined;
      const variant = byPaintIndex ?? byPhase;
      const variantPrice = readItemsApiPrice(variant);

      if (variantPrice != null) {
        return this.buildResult(
          variantPrice,
          itemName,
          variant?.phase ?? variantName,
          "steamwebapi_items_variant",
          classification,
          true,
          currency,
        );
      }

      if (variantName || paintIndex != null) {
        classification.warnings.push(
          `Items API no trajo precio para variant "${variantName ?? paintIndex}" en "${itemName}"`,
        );
        return this.buildResult(
          null,
          itemName,
          variantName,
          "none",
          classification,
          true,
          currency,
        );
      }
    }

    const basePrice = readItemsApiPrice(itemDetails);
    if (basePrice != null) {
      return this.buildResult(
        basePrice,
        itemName,
        null,
        "steamwebapi_items_exact",
        classification,
        true,
        currency,
      );
    }

    return this.buildResult(
      null,
      itemName,
      variantName,
      "none",
      classification,
      true,
      currency,
    );
  }

  resolveFromItemsCatalog(
    pricingMarketHashName: string,
    catalogIndex: SteamWebApiItemsCatalogIndex | null,
    paintIndex?: number | null,
    currency = "USD",
  ): PriceLookupResult {
    const classification = this.classifier.classify(pricingMarketHashName);
    const { normalized } = classification;
    const { baseName, phase } = this.normalizer.splitDopplerPhase(pricingMarketHashName);
    const variantName = normalized.variantName ?? phase;

    if (!catalogIndex) {
      return this.buildResult(
        null,
        pricingMarketHashName,
        variantName,
        "none",
        classification,
        false,
        currency,
      );
    }

    const candidates = this.catalogRowsForPricingName(
      pricingMarketHashName,
      catalogIndex,
      baseName,
    );

    if (candidates.length === 0) {
      classification.warnings.push(
        `No hay fila en catálogo local Items API para "${pricingMarketHashName}"`,
      );
      return this.buildResult(
        null,
        pricingMarketHashName,
        variantName,
        "none",
        classification,
        false,
        currency,
      );
    }

    const byPaintIndex =
      paintIndex != null
        ? candidates.find((row) => rowPaintIndex(row) === paintIndex)
        : undefined;
    const byPhase = variantName
      ? candidates.find((row) => phaseMatches(variantName, phaseForPaintIndex(rowPaintIndex(row))))
      : undefined;
    const selected = byPaintIndex ?? byPhase;

    if (selected) {
      const price = readCatalogRowPrice(selected);
      if (price != null) {
        return this.buildResult(
          price,
          selected.markethashname ?? selected.market_hash_name ?? selected.marketname ?? pricingMarketHashName,
          variantName ?? phaseForPaintIndex(rowPaintIndex(selected)),
          "steamwebapi_items_catalog_variant",
          classification,
          true,
          currency,
        );
      }
    }

    if (variantName || paintIndex != null) {
      const variantWithPrice = this.catalogVariantWithPrice(
        candidates,
        variantName,
        paintIndex,
      );
      if (variantWithPrice) {
        return this.buildResult(
          variantWithPrice.price,
          variantWithPrice.lookupKey,
          variantWithPrice.variantKey,
          "steamwebapi_items_catalog_variant",
          classification,
          true,
          currency,
        );
      }

      classification.warnings.push(
        `Catálogo local sin precio de variant para "${variantName ?? paintIndex}" en "${pricingMarketHashName}"`,
      );
      return this.buildResult(
        null,
        pricingMarketHashName,
        variantName,
        "none",
        classification,
        true,
        currency,
      );
    }

    const exact = candidates.find((row) => readCatalogRowPrice(row) != null);
    const exactPrice = readCatalogRowPrice(exact);
    if (exactPrice != null) {
      return this.buildResult(
        exactPrice,
        exact?.markethashname ?? exact?.market_hash_name ?? exact?.marketname ?? pricingMarketHashName,
        null,
        "steamwebapi_items_catalog_exact",
        classification,
        true,
        currency,
      );
    }

    return this.buildResult(
      null,
      pricingMarketHashName,
      variantName,
      "none",
      classification,
      true,
      currency,
    );
  }

  /**
   * Si el catálogo bulk no tiene variant/fila, refresca vía
   * GET /market/youpin/prices?market_hash_name=... (una vez por clave).
   */
  async resolveWithRefresh(
    pricingMarketHashName: string,
    catalog: PriceCatalog,
    client: SteamWebApiMarketPricesClient,
    refreshedKeys: Set<string>,
    currency = "USD",
  ): Promise<PriceLookupResult> {
    let result = this.resolve(pricingMarketHashName, catalog, currency);
    if (result.price != null) return result;

    const keysToTry: string[] = [pricingMarketHashName];
    const { normalized } = result.classification;
    if (normalized.variantName) {
      const { baseName } = this.normalizer.splitDopplerPhase(
        this.normalizer.stripWear(pricingMarketHashName),
      );
      if (baseName && !keysToTry.includes(baseName)) keysToTry.push(baseName);
    }

    for (const key of keysToTry) {
      if (refreshedKeys.has(key)) continue;
      refreshedKeys.add(key);

      const row = await client.fetchYoupinByMarketHashName(key);
      if (row?.market_hash_name) {
        catalog.set(row.market_hash_name, row);
      }

      result = this.resolve(pricingMarketHashName, catalog, currency);
      if (result.price != null) return result;
    }

    return result;
  }

  /**
   * Respaldo para bots: prueba mercados secundarios (buff, csfloat) vía
   * GET /markets/prices?market_hash_name=... cuando YouPin devuelve source "none".
   */
  async resolveSecondaryMarkets(
    pricingMarketHashName: string,
    client: SteamWebApiMarketPricesClient,
    markets: string[],
    currency = "USD",
  ): Promise<PriceLookupResult> {
    const keysToTry = this.lookupKeysForPricingName(pricingMarketHashName);

    for (const key of keysToTry) {
      const marketRows = await client.fetchMarketsPricesByMarketHashName(key, markets);

      for (const market of markets) {
        const row = marketRows.get(market);
        if (!row) continue;

        const catalog = this.catalogFromRow(row, key);
        const result = this.resolve(pricingMarketHashName, catalog, currency);
        if (result.price == null) continue;

        return {
          ...result,
          market: market as PriceMarket,
          source:
            result.source === "steamwebapi_market_exact"
              ? "steamwebapi_secondary_exact"
              : "steamwebapi_secondary_variant",
        };
      }
    }

    return this.resolve(pricingMarketHashName, new Map(), currency);
  }

  private lookupKeysForPricingName(pricingMarketHashName: string): string[] {
    const keys = [pricingMarketHashName];
    const classification = this.classifier.classify(pricingMarketHashName);
    if (classification.normalized.variantName) {
      const { baseName } = this.normalizer.splitDopplerPhase(
        this.normalizer.stripWear(pricingMarketHashName),
      );
      if (baseName && !keys.includes(baseName)) keys.push(baseName);
    }
    return keys;
  }

  private catalogFromRow(
    row: SteamWebApiYoupinPriceRow,
    queriedKey: string,
  ): PriceCatalog {
    const catalog: PriceCatalog = new Map();
    if (row.market_hash_name) catalog.set(row.market_hash_name, row);
    if (queriedKey !== row.market_hash_name) catalog.set(queriedKey, row);
    return catalog;
  }

  private catalogRowsForPricingName(
    pricingMarketHashName: string,
    catalogIndex: SteamWebApiItemsCatalogIndex,
    baseName: string,
  ): SteamWebApiItemsCatalogRow[] {
    const keys = new Set<string>([
      normalizeKey(pricingMarketHashName),
      normalizeKey(baseName || pricingMarketHashName),
    ]);
    const rows: SteamWebApiItemsCatalogRow[] = [];

    for (const key of keys) {
      const found = catalogIndex.rowsByName.get(key);
      if (!found) continue;
      for (const row of found) {
        if (!rows.includes(row)) rows.push(row);
      }
    }

    return rows;
  }

  private catalogVariantWithPrice(
    candidates: SteamWebApiItemsCatalogRow[],
    variantName: string | null,
    paintIndex?: number | null,
  ): { price: number; lookupKey: string; variantKey: string | null } | null {
    for (const row of candidates) {
      if (!Array.isArray(row.variants)) continue;
      const variant = row.variants.find((candidate) => {
        const candidatePaint = variantPaintIndex(candidate);
        if (paintIndex != null && candidatePaint === paintIndex) return true;
        return variantName ? phaseMatches(variantName, candidate.phase) : false;
      });
      const price = readItemsApiPrice(variant);
      if (variant && price != null) {
        return {
          price,
          lookupKey:
            row.markethashname ??
            row.market_hash_name ??
            row.marketname ??
            "items-catalog-variant",
          variantKey: variant.phase ?? variantName,
        };
      }
    }
    return null;
  }

  private tryExact(name: string, catalog: PriceCatalog): number | null {
    const row = catalog.get(name);
    if (!row) return null;
    const price = Number(row.price);
    return price > 0 ? price : null;
  }

  private tryStickerAlias(
    name: string,
    catalog: PriceCatalog,
  ): { price: number; key: string } | null {
    let alt: string | null = null;
    if (name.startsWith("Sticker | ")) {
      alt = name.replace("Sticker | ", "Sticker Slab | ");
    } else if (name.startsWith("Sticker Slab | ")) {
      alt = name.replace("Sticker Slab | ", "Sticker | ");
    }
    if (!alt) return null;
    const price = this.tryExact(alt, catalog);
    return price != null ? { price, key: alt } : null;
  }

  private buildResult(
    price: number | null,
    lookupKey: string,
    variantKey: string | null,
    source: PriceLookupResult["source"],
    classification: PriceLookupResult["classification"],
    apiRowFound: boolean,
    currency: string,
  ): PriceLookupResult {
    return {
      price,
      currency,
      market: "youpin",
      source,
      lookupKey,
      variantKey,
      classification,
      apiRowFound,
    };
  }
}
