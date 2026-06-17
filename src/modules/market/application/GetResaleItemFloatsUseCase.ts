import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { IMarketRepository } from "../domain/IMarketRepository";
import { FloatItem } from "../domain/FloatItem";

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
 * Devuelve floats persistidos en DB para un listing de reventa.
 * Acepta: MarketListing.id, `market-{name}` (legacy) o `youpin-{floatItemId}`.
 * Los precios vienen del sync de catálogo (/steam/api/float/assets); no re-consulta la API.
 */
export class GetResaleItemFloatsUseCase {
  constructor(private marketRepository: IMarketRepository) {}

  async execute(resaleItemId: string): Promise<(FloatItem & { displayPrice: number })[]> {
    const listingId = await this.resolveListingId(resaleItemId);
    const floats = await this.marketRepository.findFloatsByResaleItemId(listingId);

    const settings = await prisma.adminSettings.findFirst();
    const settingsData = settings ?? {
      marketModifierEnabled: false,
      marketModifierType: 'percentage_increase',
      marketModifierValue: 0,
    };

    return floats.map((f) => ({
      ...f,
      displayPrice: applyModifier(
        f.price,
        settingsData.marketModifierEnabled,
        settingsData.marketModifierType,
        settingsData.marketModifierValue,
      ),
    }));
  }

  private async resolveListingId(resaleItemId: string): Promise<string> {
    if (resaleItemId.startsWith("youpin-")) {
      const floatId = resaleItemId.replace(/^youpin-/, "");
      const floatRow = await prisma.floatItem.findUnique({
        where: { id: floatId },
        select: { resaleItemId: true },
      });
      if (!floatRow) {
        throw new Error(`FloatItem youpin-${floatId} no existe.`);
      }
      return floatRow.resaleItemId;
    }

    if (resaleItemId.startsWith("market-")) {
      const listing = await prisma.marketListing.findUnique({
        where: { name: resaleItemId.replace(/^market-/, "") },
      });
      if (!listing) {
        throw new Error(`Market listing "${resaleItemId}" no existe.`);
      }
      return listing.id;
    }

    const listing = await prisma.marketListing.findUnique({
      where: { id: resaleItemId },
    });
    if (!listing) {
      throw new Error(`Market listing con ID ${resaleItemId} no existe.`);
    }
    return listing.id;
  }
}
