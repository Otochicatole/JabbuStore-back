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

  static async updateUserSellSettings(data: {
    userSellModifierType?: string;
    userSellModifierValue?: number;
    userSellModifierEnabled?: boolean;
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

  static async updateWebhookUrl(webhookUrl: string | null) {
    const settings = await this.getSettings();
    return prisma.adminSettings.update({
      where: { id: settings.id },
      data: { webhookUrl }
    });
  }

  static async updatePaymentMethodSettings(data: {
    mercadoPagoEnabled?: boolean;
    paypalEnabled?: boolean;
    nowpaymentsEnabled?: boolean;
  }) {
    const settings = await this.getSettings();
    return prisma.adminSettings.update({
      where: { id: settings.id },
      data,
    });
  }

  static async updateManualTransferSettings(data: {
    manualTransferEnabled?: boolean;
    manualBankAlias?: string | null;
    manualBankCbu?: string | null;
    manualBankHolder?: string | null;
    manualBankInstructions?: string | null;
    manualCryptoAddress?: string | null;
    manualCryptoNetwork?: string | null;
    manualCryptoInstructions?: string | null;
  }) {
    const settings = await this.getSettings();
    return prisma.adminSettings.update({
      where: { id: settings.id },
      data,
    });
  }

  static async updateResellSettings(data: {
    resellModifierType?: string;
    resellModifierValue?: number;
    resellModifierEnabled?: boolean;
  }) {
    const settings = await this.getSettings();
    return prisma.adminSettings.update({
      where: { id: settings.id },
      data: {
        ...(data.resellModifierType !== undefined
          ? { marketModifierType: data.resellModifierType }
          : {}),
        ...(data.resellModifierValue !== undefined
          ? { marketModifierValue: data.resellModifierValue }
          : {}),
        ...(data.resellModifierEnabled !== undefined
          ? { marketModifierEnabled: data.resellModifierEnabled }
          : {}),
      },
    });
  }
}
