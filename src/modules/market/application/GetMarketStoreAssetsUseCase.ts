import { promises as fs } from 'fs';
import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IMarketRepository } from '../domain/IMarketRepository';
import { MarketStoreAsset } from '../domain/MarketStoreAsset';
import { resolveListingNameFromAsset } from './floatCatalogMapper';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';
import type { CatalogGlobalPayload, CatalogGlobalItemRow } from './GenerateCatalogGlobalUseCase';
import { CATALOG_GLOBAL_JSON_PATH } from './GenerateCatalogGlobalUseCase';

function applyModifier(basePrice: number, enabled: boolean, type: string, value: number): number {
  if (!enabled) return basePrice;

  let modifier = 0;
  switch (type) {
    case 'percentage_increase': modifier = (basePrice * value) / 100; break;
    case 'percentage_decrease': modifier = -((basePrice * value) / 100); break;
    case 'fixed_increase': modifier = value; break;
    case 'fixed_decrease': modifier = -value; break;
  }

  return Math.max(0, Math.round((basePrice + modifier) * 100) / 100);
}

function getCatalogIconUrl(row: CatalogGlobalItemRow): string | null {
  const image = row.image;
  if (!image) return null;
  if (typeof image === 'string' && /^https?:\/\//i.test(image)) return image;
  if (typeof image === 'string' && image.length > 0) {
    return `https://community.cloudflare.steamstatic.com/economy/image/${image}/360fx360f`;
  }
  return null;
}

export class GetMarketStoreAssetsUseCase {
  constructor(private marketRepository: IMarketRepository) {}

  async execute(): Promise<(MarketStoreAsset & { displayPrice: number })[]> {
    const settings = await prisma.adminSettings.findFirst();
    const settingsData = settings ?? {
      marketModifierEnabled: false,
      marketModifierType: 'percentage_increase' as string,
      marketModifierValue: 0,
    };

    // 1. Intentar servir directamente desde catalog-global.json si existe
    try {
      const raw = await fs.readFile(CATALOG_GLOBAL_JSON_PATH, 'utf-8');
      const payload: CatalogGlobalPayload = JSON.parse(raw);

      if (Array.isArray(payload.items) && payload.items.length > 0) {
        // Cargar mapa de IDs reales de MarketListing de la BD si existen
        const dbListings = await prisma.marketListing.findMany({
          select: { id: true, name: true, price: true, isPriceManual: true },
        });
        const dbListingMap = new Map(dbListings.map((l) => [l.name, l]));

        return payload.items.flatMap((item) => {
          const name = item.markethashname ?? item.market_hash_name ?? item.marketname;
          if (!name || typeof name !== 'string') return [];

          const canonicalName = resolveListingNameFromAsset({
            market_hash_name: name,
          });
          if (!canonicalName) return [];

          const dbItem = dbListingMap.get(canonicalName);
          const listingId = dbItem?.id ?? canonicalName;
          const youpinAsk = item.youpinAsk ?? 0;
          const basePrice = (dbItem?.isPriceManual && dbItem.price) ? dbItem.price : youpinAsk;

          const displayPrice = dbItem?.isPriceManual
            ? dbItem.price
            : applyModifier(
                basePrice,
                settingsData.marketModifierEnabled,
                settingsData.marketModifierType,
                settingsData.marketModifierValue,
              );

          const details = PriceEnrichmentService.inferDetailsFromMarketHashName(canonicalName);
          const iconUrl = getCatalogIconUrl(item);

          return [{
            id: listingId,
            floatItemId: listingId,
            assetId: listingId,
            listingId: listingId,
            name: canonicalName,
            provider: 'youpin' as const,
            youpinAsk,
            youpinVolume: item.youpinVolume ?? null,
            price: basePrice,
            displayPrice,
            floatValue: 0,
            paintSeed: 0,
            float: 0,
            pattern: 0,
            inspectLink: null,
            externalId: null,
            iconUrl,
            rarity: details.rarity,
            exterior: details.exterior,
            category: details.category,
            isStatTrak: details.isStatTrak,
            isSouvenir: details.isSouvenir,
          }];
        });
      }
    } catch {
      // Si catalog-global.json no existe o falla al leerlo, fallback al repositorio DB
    }

    // 2. Fallback: Base de Datos
    const assets = await this.marketRepository.findStoreAssets();
    return assets.flatMap((asset) => {
      const canonicalName = resolveListingNameFromAsset({
        market_hash_name: asset.name,
      });
      if (!canonicalName) return [];

      return [{
        ...asset,
        id: `youpin-${asset.floatItemId}`,
        name: canonicalName,
        displayPrice: applyModifier(
          asset.price,
          settingsData.marketModifierEnabled,
          settingsData.marketModifierType,
          settingsData.marketModifierValue,
        ),
      }];
    });
  }
}
