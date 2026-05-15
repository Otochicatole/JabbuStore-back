import { prisma } from '../../../shared/infrastructure/PrismaClient';

export class PricingService {
  static async calculateFinalPrice(basePrice: number): Promise<{ finalPrice: number; modifier: number }> {
    const settings = await prisma.adminSettings.findFirst();
    if (!settings || !settings.globalPriceModifierEnabled) {
      return { finalPrice: basePrice, modifier: 0 };
    }

    let modifier = 0;
    const value = settings.globalPriceModifierValue;
    
    switch (settings.globalPriceModifierType) {
      case 'percentage_increase':
        modifier = (basePrice * value) / 100;
        break;
      case 'percentage_decrease':
        modifier = -((basePrice * value) / 100);
        break;
      case 'fixed_increase':
        modifier = value;
        break;
      case 'fixed_decrease':
        modifier = -value;
        break;
    }

    let finalPrice = basePrice + modifier;
    if (finalPrice < 0) finalPrice = 0;
    
    // Convert to 2 decimal places to avoid float precision issues
    finalPrice = Math.round(finalPrice * 100) / 100;
    modifier = Math.round(modifier * 100) / 100;

    return { finalPrice, modifier };
  }
}
