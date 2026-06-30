/**
 * @deprecated Usar `SteamWebApiMarketPricesClient` desde `modules/pricing`.
 * Wrapper de compatibilidad para código existente.
 */
import {
  BotPriceLookupService,
  MarketHashNameNormalizer,
  SteamWebApiMarketPricesClient,
  YOUPIN_MARKET_PRICES_URL,
} from "../../modules/pricing";
import type { PriceCatalog } from "../../modules/pricing";

export { YOUPIN_MARKET_PRICES_URL };
export type {
  YoupinMarketPriceRow,
  YoupinVariantValue,
} from "../../modules/pricing/domain/types";

const client = new SteamWebApiMarketPricesClient();
const lookup = new BotPriceLookupService();
const normalizer = new MarketHashNameNormalizer();

export class SteamWebApiYoupinPricesClient {
  fetchCatalog(forceRefresh = false): Promise<PriceCatalog> {
    return client.fetchYoupinCatalog(forceRefresh);
  }

  fetchPriceByMarketHashName(
    marketHashName: string,
    getBaseNameAndPhase: (name: string) => { baseName: string; phase: string | null },
  ): Promise<number | null> {
    return client.fetchYoupinByMarketHashName(marketHashName).then((row) => {
      if (!row) return null;
      const temp = new Map([[row.market_hash_name, row]]);
      return lookup.resolve(marketHashName, temp).price;
    });
  }

  resolvePriceFromCatalog(
    itemName: string,
    catalog: PriceCatalog,
    _getBaseNameAndPhase: (name: string) => { baseName: string; phase: string | null },
  ): number | null {
    return lookup.resolve(itemName, catalog).price;
  }

  resolvePriceForItem(
    itemName: string,
    catalog: PriceCatalog,
    _getBaseNameAndPhase: (name: string) => { baseName: string; phase: string | null },
  ): number | null {
    return lookup.resolve(itemName, catalog).price;
  }

  static clearCache(): void {
    SteamWebApiMarketPricesClient.clearCache();
  }
}

export function encodeYoupinMarketHashName(name: string): string {
  return encodeURIComponent(name).replace(/\(/g, "%28").replace(/\)/g, "%29");
}
