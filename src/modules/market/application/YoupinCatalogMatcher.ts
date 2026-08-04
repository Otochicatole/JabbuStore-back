import type { SteamWebApiItemsCatalogRow, SteamWebApiYoupinPriceRow } from '../../pricing';
import type { MarketListingUpsert } from '../domain/MarketListing';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';
import { MarketPricingService, type MarketModifierSettings } from './MarketPricingService';

/**
 * Cruza items-catalog.json con /market/youpin/prices por market_hash_name exacto.
 *
 * Reglas:
 * - Comparacion por igualdad exacta luego de trim().
 * - No se filtra por quantity (solo dato informativo).
 * - Se exige precio youpin > 0.
 * - Si hay filas duplicadas de prices con el mismo market_hash_name,
 *   se toma la de precio mas bajo (estrategia conservadora).
 */

export interface CatalogMatchResult {
  listings: MarketListingUpsert[];
  totalCatalogItems: number;
  totalPriceRows: number;
  matched: number;
  skippedNoPrice: number;
  skippedNotInCatalog: number;
  skippedNotInPrices: number;
}

function getCatalogMarketHashName(row: SteamWebApiItemsCatalogRow): string | null {
  const name =
    row.markethashname ??
    row.market_hash_name ??
    row.marketname ??
    row.normalizedname;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

function getCatalogIconUrl(row: SteamWebApiItemsCatalogRow): string | null {
  const image = row.image || row.itemimage;
  if (!image) return null;
  if (typeof image === 'string' && /^https?:\/\//i.test(image)) return image;
  // SteamWebAPI puede devolver solo el hash — construir URL completa.
  if (typeof image === 'string' && image.length > 0) {
    return `https://community.cloudflare.steamstatic.com/economy/image/${image}/360fx360f`;
  }
  return null;
}

/**
 * Construye un Map<marketHashName, SteamWebApiItemsCatalogRow> desde items-catalog.json.
 * Normaliza las diferentes variantes del campo nombre.
 */
export function buildCatalogIndex(
  items: SteamWebApiItemsCatalogRow[],
): Map<string, SteamWebApiItemsCatalogRow> {
  const index = new Map<string, SteamWebApiItemsCatalogRow>();
  for (const row of items) {
    const name = getCatalogMarketHashName(row);
    if (!name) continue;
    // Si hay duplicados, el primero gana (el snapshot ya es determinista)
    if (!index.has(name)) {
      index.set(name, row);
    }
  }
  return index;
}

/**
 * Construye un Map<marketHashName, SteamWebApiYoupinPriceRow> desde /market/youpin/prices.
 * Si hay duplicados, se conserva el de precio mas bajo.
 */
export function buildYoupinPricesIndex(
  rows: SteamWebApiYoupinPriceRow[],
): Map<string, SteamWebApiYoupinPriceRow> {
  const index = new Map<string, SteamWebApiYoupinPriceRow>();
  for (const row of rows) {
    if (!row?.market_hash_name) continue;
    const key = row.market_hash_name.trim();
    if (!key) continue;
    const existing = index.get(key);
    if (!existing || (row.price ?? 0) < existing.price) {
      index.set(key, row);
    }
  }
  return index;
}

/**
 * Realiza el cruce y genera los MarketListingUpsert candidatos.
 *
 * @param catalogIndex   Map<marketHashName, CatalogRow> de items-catalog.json
 * @param pricesIndex    Map<marketHashName, YoupinPriceRow> de /market/youpin/prices
 * @param settings       Configuracion del modificador de mercado
 */
export function matchCatalogWithYoupinPrices(
  catalogIndex: Map<string, SteamWebApiItemsCatalogRow>,
  pricesIndex: Map<string, SteamWebApiYoupinPriceRow>,
  settings: MarketModifierSettings,
): CatalogMatchResult {
  const listings: MarketListingUpsert[] = [];
  let skippedNoPrice = 0;
  let skippedNotInCatalog = 0;

  for (const [marketHashName, priceRow] of pricesIndex.entries()) {
    const youpinAsk = typeof priceRow.price === 'number' ? priceRow.price : 0;

    if (youpinAsk <= 0) {
      skippedNoPrice++;
      continue;
    }

    const catalogRow = catalogIndex.get(marketHashName);
    if (!catalogRow) {
      skippedNotInCatalog++;
      continue;
    }

    const details = PriceEnrichmentService.inferDetailsFromMarketHashName(marketHashName);
    const iconUrl = getCatalogIconUrl(catalogRow);
    const price = MarketPricingService.computeListingPrice(youpinAsk, settings);

    listings.push({
      name: marketHashName,
      provider: 'youpin',
      youpinAsk,
      youpinVolume: typeof priceRow.quantity === 'number' ? priceRow.quantity : null,
      price,
      iconUrl,
      rarity: details.rarity,
      exterior: details.exterior,
      category: details.category,
      isStatTrak: details.isStatTrak,
      isSouvenir: details.isSouvenir,
    });
  }

  const skippedNotInPrices = catalogIndex.size - (pricesIndex.size - skippedNotInCatalog);

  return {
    listings,
    totalCatalogItems: catalogIndex.size,
    totalPriceRows: pricesIndex.size,
    matched: listings.length,
    skippedNoPrice,
    skippedNotInCatalog,
    skippedNotInPrices: Math.max(0, skippedNotInPrices),
  };
}