import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { SteamWebApiFloatAssetsClient, parseFloatAssetsResponse } from '../infrastructure/SteamWebApiFloatAssetsClient';
import { assetToFloatItem } from './floatCatalogMapper';
import { roundMoney } from '../../orders/application/OrderPricingService';
import { stableMarketFloatId } from '../infrastructure/PrismaMarketRepository';

export interface YoupinAssetValidationResult {
  valid: boolean;
  assetId: string;
  floatValue: number;
  paintSeed: number;
  price: number;
  inspectLink: string | null;
  listingId: string;
  fromApi: boolean;
}

interface BatchAssetToValidate {
  assetId: string;
  listingId: string;
}

export class YoupinAssetValidator {
  private apiClient: SteamWebApiFloatAssetsClient;

  constructor(apiClient?: SteamWebApiFloatAssetsClient) {
    this.apiClient = apiClient ?? new SteamWebApiFloatAssetsClient();
  }

  async validateBatch(
    missingAssets: BatchAssetToValidate[],
  ): Promise<Map<string, YoupinAssetValidationResult>> {
    const result = new Map<string, YoupinAssetValidationResult>();

    const listingGroups = new Map<string, BatchAssetToValidate[]>();
    for (const asset of missingAssets) {
      const group = listingGroups.get(asset.listingId) || [];
      group.push(asset);
      listingGroups.set(asset.listingId, group);
    }

    for (const [listingId, assets] of listingGroups) {
      try {
        const apiPage = await this.apiClient.fetchPage({
          source: 'youpin',
          marketHashName: listingId,
          onlyMarketId: true,
          withItems: true,
          limit: 100,
          offset: 0,
          sort: 'newest',
          rateLimitPriority: 'normal',
          requestTimeoutMs: 10000,
        });

        if (!apiPage.ok || !apiPage.assets.length) continue;

        for (const raw of apiPage.assets) {
          const rawAssetId = String(raw.assetid ?? raw.asset_id ?? raw.id ?? '');
          const matchingAsset = assets.find((a) => a.assetId === rawAssetId);
          if (!matchingAsset) continue;

          const floatItem = assetToFloatItem(raw, listingId);
          if (!floatItem) continue;

          const dbId = stableMarketFloatId('YOUPIN', floatItem.assetId);
          try {
            await prisma.floatItem.upsert({
              where: { id: dbId },
              create: {
                id: dbId,
                assetId: floatItem.assetId,
                floatValue: floatItem.floatValue,
                paintSeed: floatItem.paintSeed,
                market: 'YOUPIN',
                price: floatItem.price,
                inspectLink: floatItem.inspectLink ?? null,
                available: true,
                externalId: floatItem.externalId ?? null,
                lastSyncAt: new Date(),
                listingId,
              },
              update: {
                floatValue: floatItem.floatValue,
                paintSeed: floatItem.paintSeed,
                price: floatItem.price,
                inspectLink: floatItem.inspectLink ?? null,
                available: true,
                externalId: floatItem.externalId ?? null,
                lastSyncAt: new Date(),
              },
            });
          } catch (err) {
            console.warn(`[YoupinAssetValidator] Error upserting asset ${floatItem.assetId}:`, err);
          }

          result.set(`youpin-${floatItem.assetId}`, {
            valid: true,
            assetId: floatItem.assetId,
            floatValue: floatItem.floatValue,
            paintSeed: floatItem.paintSeed,
            price: roundMoney(floatItem.price),
            inspectLink: floatItem.inspectLink ?? null,
            listingId,
            fromApi: true,
          });
        }
      } catch (err) {
        console.warn(`[YoupinAssetValidator] API error for listing ${listingId}:`, err);
      }
    }

    return result;
  }

  async validateSingle(
    assetId: string,
    listingId: string,
  ): Promise<YoupinAssetValidationResult | null> {
    const results = await this.validateBatch([{ assetId, listingId }]);
    return results.get(`youpin-${assetId}`) ?? null;
  }
}
