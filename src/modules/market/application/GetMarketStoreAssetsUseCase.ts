import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IMarketRepository } from '../domain/IMarketRepository';
import { MarketStoreAsset } from '../domain/MarketStoreAsset';

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

export class GetMarketStoreAssetsUseCase {
  constructor(private marketRepository: IMarketRepository) {}

  async execute(): Promise<(MarketStoreAsset & { displayPrice: number })[]> {
    const [assets, settings] = await Promise.all([
      this.marketRepository.findStoreAssets(),
      prisma.adminSettings.findFirst(),
    ]);

    const settingsData = settings ?? {
      marketModifierEnabled: false,
      marketModifierType: 'percentage_increase' as string,
      marketModifierValue: 0,
    };

    return assets.map((asset) => ({
      ...asset,
      id: `youpin-${asset.floatItemId}`,
      displayPrice: applyModifier(
        asset.price,
        settingsData.marketModifierEnabled,
        settingsData.marketModifierType,
        settingsData.marketModifierValue,
      ),
    }));
  }
}
