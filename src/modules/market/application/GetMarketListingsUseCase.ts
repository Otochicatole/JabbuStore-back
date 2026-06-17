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
export interface GetMarketListingsOptions {
  /** Si true, incluye listings del catálogo global aunque no tengan floats (panel admin). */
  includeWithoutFloats?: boolean;
}

export class GetMarketListingsUseCase {
  constructor(private marketRepository: IMarketRepository) {}

  async execute(
    options: GetMarketListingsOptions = {},
  ): Promise<(MarketListing & { displayPrice: number; floatCount?: number })[]> {
    const includeWithoutFloats = options.includeWithoutFloats === true;

    // Catálogo público = assets YouPin indexados (FloatItem); admin ?all=true = listings agrupados.
    const [listings, settings] = await Promise.all([
      includeWithoutFloats
        ? this.marketRepository.findAll()
        : this.marketRepository.findAllForStore(),
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
