import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IMarketRepository } from '../domain/IMarketRepository';
import { MarketListing } from '../domain/MarketListing';

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

/**
 * Devuelve todos los market listings activos con el precio de display
 * calculado en base al modificador de mercado configurado en AdminSettings.
 */
export class GetMarketListingsUseCase {
  constructor(private marketRepository: IMarketRepository) {}

  async execute(): Promise<(MarketListing & { displayPrice: number })[]> {
    const [listings, settings] = await Promise.all([
      this.marketRepository.findAll(),
      prisma.adminSettings.findFirst(),
    ]);

    const settingsData = settings ?? {
      marketModifierEnabled: false,
      marketModifierType: 'percentage_increase' as string,
      marketModifierValue: 0,
    };

    return listings.map((listing) => ({
      ...listing,
      displayPrice: applyModifier(
        listing.price,
        settingsData.marketModifierEnabled,
        settingsData.marketModifierType,
        settingsData.marketModifierValue,
      ),
    }));
  }
}
