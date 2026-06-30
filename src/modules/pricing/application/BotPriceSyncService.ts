import { config } from "../../../shared/config";
import type { BotPriceSyncStats, PriceableBotItem } from "../domain/types";
import { BotPriceLookupService } from "./BotPriceLookupService";
import { MarketHashNameNormalizer } from "./MarketHashNameNormalizer";
import { SteamWebApiItemsCatalogStore } from "../infrastructure/SteamWebApiItemsCatalogStore";

export interface BotPriceSyncOptions {
  forceRefreshCatalog?: boolean;
  preserveExistingWhenMissing?: boolean;
  useFallbackWhenMissing?: boolean;
  logWarnings?: boolean;
}

export interface BotPriceSyncResult<T extends PriceableBotItem> {
  items: T[];
  stats: BotPriceSyncStats;
  catalogAvailable: boolean;
  catalogErrors: string[];
}

function isHighTierItem(item: PriceableBotItem): boolean {
  const name = item.name.toLowerCase();
  const type = item.type.toLowerCase();
  return (
    name.includes("★") ||
    name.includes("doppler") ||
    name.includes("dragon lore") ||
    name.includes("howl") ||
    name.includes("fade") ||
    name.includes("case hardened") ||
    type.includes("knife") ||
    type.includes("cuchillo") ||
    type.includes("gloves") ||
    type.includes("guantes")
  );
}

/**
 * Sincroniza precios de bot items contra el catálogo local de SteamWebAPI Items API.
 */
export class BotPriceSyncService {
  private catalogStore = new SteamWebApiItemsCatalogStore();
  private lookup = new BotPriceLookupService();
  private normalizer = new MarketHashNameNormalizer();

  async enrichItems<T extends PriceableBotItem>(
    items: T[],
    options: BotPriceSyncOptions = {},
  ): Promise<BotPriceSyncResult<T>> {
    const {
      forceRefreshCatalog = false,
      preserveExistingWhenMissing = false,
      useFallbackWhenMissing = true,
      logWarnings = true,
    } = options;

    const emptyStats = (): BotPriceSyncStats => ({
      total: items.length,
      pricedExact: 0,
      pricedVariant: 0,
      pricedSecondary: 0,
      fallback: 0,
      unpriced: items.length,
      warnings: [],
    });

    if (items.length === 0) {
      return {
        items,
        stats: { ...emptyStats(), total: 0, unpriced: 0 },
        catalogAvailable: false,
        catalogErrors: [],
      };
    }

    const pricingNames = new Map<T, string>();
    for (const item of items) {
      if (!item.name) continue;
      const pricingName = this.normalizer.buildPricingMarketHashName({
        marketHashName: item.name,
        iconUrl: item.iconUrl,
        paintIndex: item.paintIndex,
      });
      pricingNames.set(item, pricingName);
    }

    if (forceRefreshCatalog) {
      this.catalogStore.clearMemoryCache();
    }

    const catalogIndex = await this.catalogStore.getIndex();
    const catalogAvailable = Boolean(catalogIndex && catalogIndex.itemCount > 0);
    const itemErrors: string[] = catalogAvailable
      ? []
      : ["Catálogo local Items API no disponible. Actualizalo desde el admin."];

    if (!catalogAvailable) {
      console.error(
        "[Bot Price Sync] Catálogo local Items API no disponible — se conservan precios actuales de los ítems.",
      );
      for (const err of itemErrors) {
        console.error(`[Bot Price Sync] ${err}`);
      }
      return {
        items: items.map((item) => ({ ...item })),
        stats: {
          ...emptyStats(),
          warnings: itemErrors,
        },
        catalogAvailable: false,
        catalogErrors: itemErrors,
      };
    }

    const stats: BotPriceSyncStats = {
      total: items.length,
      pricedExact: 0,
      pricedVariant: 0,
      pricedSecondary: 0,
      fallback: 0,
      unpriced: 0,
      warnings: [],
    };

    const enriched: T[] = [];

    for (const item of items) {
      if (!item.name) {
        enriched.push({ ...item, price: preserveExistingWhenMissing ? item.price : 0 });
        stats.unpriced++;
        continue;
      }

      const pricingName =
        pricingNames.get(item) ??
        this.normalizer.buildPricingMarketHashName({
          marketHashName: item.name,
          iconUrl: item.iconUrl,
          paintIndex: item.paintIndex,
        });
      const result = this.lookup.resolveFromItemsCatalog(
        pricingName,
        catalogIndex,
        item.paintIndex,
        config.itemsCatalog.currency,
      );

      let finalPrice: number;
      if (result.price != null && result.price > 0) {
        let acceptedCatalogPrice = true;
        if (this.shouldPreserveSuspiciousExistingPrice(item, result.price)) {
          finalPrice = item.price;
          acceptedCatalogPrice = false;
          stats.unpriced++;
          const warning = `${pricingName}: precio nuevo sospechosamente bajo ($${result.price}) vs actual ($${item.price}); conservado`;
          stats.warnings.push(warning);
          if (logWarnings) console.warn(`[Bot Price Sync] ${warning}`);
        } else {
          finalPrice = result.price;
        }
        if (acceptedCatalogPrice && (
          result.source === "steamwebapi_items_catalog_exact" ||
          result.source === "steamwebapi_items_exact" ||
          result.source === "steamwebapi_market_exact"
        )) {
          stats.pricedExact++;
        } else if (acceptedCatalogPrice && (
          result.source === "steamwebapi_items_catalog_variant" ||
          result.source === "steamwebapi_items_variant" ||
          result.source === "steamwebapi_market_variant"
        )) {
          stats.pricedVariant++;
        } else if (acceptedCatalogPrice && (
          result.source === "steamwebapi_secondary_exact" ||
          result.source === "steamwebapi_secondary_variant"
        )) {
          stats.pricedSecondary++;
          if (logWarnings) {
            console.log(
              `[Bot Price Sync] ${pricingName}: precio vía ${result.market} (${result.source}) → $${result.price}`,
            );
          }
        }
      } else if (preserveExistingWhenMissing && item.price > 0) {
        finalPrice = item.price;
        stats.unpriced++;
      } else if (useFallbackWhenMissing && !isHighTierItem(item)) {
        finalPrice = this.localFallbackPrice(item);
        stats.fallback++;
        if (logWarnings) {
          console.warn(
            `[Bot Price Sync] Sin precio en catálogo local para "${pricingName}" → fallback $${finalPrice}`,
          );
        }
      } else {
        finalPrice = 0;
        stats.unpriced++;
        if (logWarnings && isHighTierItem(item)) {
          console.warn(
            `[Bot Price Sync] Sin precio en catálogo local Items API para "${pricingName}" — precio queda en 0.`,
          );
        }
      }

      for (const w of result.classification.warnings) {
        stats.warnings.push(`${pricingName}: ${w}`);
        if (logWarnings) console.warn(`[Bot Price Sync] ${pricingName}: ${w}`);
      }

      const nameHasPhase =
        pricingName.includes(" | Phase") ||
        pricingName.includes(" | Ruby") ||
        pricingName.includes(" | Sapphire") ||
        pricingName.includes(" | Black Pearl") ||
        pricingName.includes(" | Emerald");

      enriched.push({
        ...item,
        name: nameHasPhase ? pricingName : item.name,
        price: finalPrice ?? 0,
      });
    }

    console.log(
      `[Bot Price Sync] ${stats.total} ítems — exact: ${stats.pricedExact}, variant: ${stats.pricedVariant}, secondary: ${stats.pricedSecondary}, fallback: ${stats.fallback}, sin precio/conservados: ${stats.unpriced}`,
    );

    return {
      items: enriched,
      stats,
      catalogAvailable: true,
      catalogErrors: itemErrors,
    };
  }

  clearCatalogCache(): void {
    this.catalogStore.clearMemoryCache();
  }

  private shouldPreserveSuspiciousExistingPrice(
    item: PriceableBotItem,
    newPrice: number,
  ): boolean {
    if (!isHighTierItem(item)) return false;
    if (!Number.isFinite(item.price) || item.price <= 0) return false;
    if (item.price < 50) return false;
    return newPrice < 5 || newPrice < item.price * 0.15;
  }

  private localFallbackPrice(item: PriceableBotItem): number {
    const typeLower = item.type.toLowerCase();
    if (
      typeLower.includes("sticker") ||
      typeLower.includes("case") ||
      typeLower.includes("capsule") ||
      typeLower.includes("charm") ||
      typeLower.includes("agent") ||
      typeLower.includes("music")
    ) {
      return 0.15;
    }
    let base = 1.5;
    const variance = (this.hashCode(item.assetId) % 100) / 100;
    return Math.round(base * (0.8 + variance * 0.4) * 100) / 100;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
