import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { StoreItem } from '../domain/Item';
import { IStoreRepository } from '../domain/IStoreRepository';
import { BotService } from '../../marketplace/application/BotService';

function applyModifier(basePrice: number, enabled: boolean, type: string, value: number): number {
  if (!enabled) return basePrice;

  let modifier = 0;

  switch (type) {
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
    await BotService.purgeStoreItemsForInactiveBots();

    const [items, settings] = await Promise.all([
      this.storeRepository.findAll(),
      prisma.adminSettings.findFirst(),
    ]);

    const settingsData = settings ?? {
      globalPriceModifierEnabled: false,
      globalPriceModifierType: 'percentage_increase',
      globalPriceModifierValue: 0,
    };

    return items.map((item) => ({
      ...item,
      displayPrice: applyModifier(
        item.price,
        settingsData.globalPriceModifierEnabled,
        settingsData.globalPriceModifierType,
        settingsData.globalPriceModifierValue,
      ),
    }));
  }
}
