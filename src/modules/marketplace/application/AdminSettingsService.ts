import { prisma } from '../../../shared/infrastructure/PrismaClient';
import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivateIp(address: string) {
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }

  if (!net.isIPv4(address)) return false;

  const [a = 0, b = 0] = address.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

async function normalizeWebhookUrl(webhookUrl: string | null | undefined) {
  const raw = webhookUrl?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Webhook URL inválida.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('El webhook debe usar HTTPS.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('El webhook no puede apuntar a localhost.');
  }

  const literalIp = net.isIP(hostname) ? [hostname] : [];
  const resolvedIps = literalIp.length
    ? literalIp
    : (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);

  if (resolvedIps.length === 0 || resolvedIps.some(isPrivateIp)) {
    throw new Error('El webhook no puede apuntar a redes privadas o reservadas.');
  }

  parsed.hash = '';
  return parsed.toString();
}

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
    const safeWebhookUrl = await normalizeWebhookUrl(webhookUrl);
    return prisma.adminSettings.update({
      where: { id: settings.id },
      data: { webhookUrl: safeWebhookUrl }
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
  static async updateHomeStatsSettings(data: {
    homeStatsActiveUsers?: string;
    homeStatsAvailableSkins?: string;
    homeStatsTransactions?: string;
    homeStatsOnlineSupport?: string;
  }) {
    const settings = await this.getSettings();
    return prisma.adminSettings.update({
      where: { id: settings.id },
      data,
    });
  }
}
