import { prisma } from '../../../shared/infrastructure/PrismaClient';

export class AdminSettingsService {
  static async getSettings() {
    let settings = await prisma.adminSettings.findFirst();
    if (!settings) {
      settings = await prisma.adminSettings.create({
        data: {}
      });
    }
    return settings;
  }

  static async updatePricingSettings(data: {
    globalPriceModifierType?: string;
    globalPriceModifierValue?: number;
    globalPriceModifierEnabled?: boolean;
  }) {
    const settings = await this.getSettings();
    return prisma.adminSettings.update({
      where: { id: settings.id },
      data
    });
  }

  static async updateMinimumSellPrice(minimumUserSellPrice: number) {
    const settings = await this.getSettings();
    return prisma.adminSettings.update({
      where: { id: settings.id },
      data: { minimumUserSellPrice }
    });
  }
}
