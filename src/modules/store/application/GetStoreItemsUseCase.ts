import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { StoreItem } from '../domain/Item';
import { IStoreRepository } from '../domain/IStoreRepository';

function applyModifier(basePrice: number, settings: {
  globalPriceModifierEnabled: boolean;
  globalPriceModifierType: string;
  globalPriceModifierValue: number;
}): number {
  if (!settings.globalPriceModifierEnabled) return basePrice;

  const value = settings.globalPriceModifierValue;
  let modifier = 0;

  switch (settings.globalPriceModifierType) {
    case 'percentage_increase': modifier = (basePrice * value) / 100; break;
    case 'percentage_decrease': modifier = -((basePrice * value) / 100); break;
    case 'fixed_increase': modifier = value; break;
    case 'fixed_decrease': modifier = -value; break;
  }

  const finalPrice = Math.max(0, basePrice + modifier);
  return Math.round(finalPrice * 100) / 100;
}

export class GetStoreItemsUseCase {
  constructor(private storeRepository: IStoreRepository) {}

  async execute(): Promise<(StoreItem & { displayPrice: number })[]> {
    const [items, settings] = await Promise.all([
      this.storeRepository.findAll(),
      prisma.adminSettings.findFirst(),
    ]);

    const modifierSettings = settings ?? {
      globalPriceModifierEnabled: false,
      globalPriceModifierType: 'percentage_increase',
      globalPriceModifierValue: 0,
    };

    // Apply the global price modifier in-memory — base price in DB stays untouched
    return items.map((item) => ({
      ...item,
      displayPrice: applyModifier(item.price, modifierSettings),
    }));
  }
}
