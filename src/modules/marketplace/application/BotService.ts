import { prisma } from '../../../shared/infrastructure/PrismaClient';

export class BotService {
  static async getAllBots() {
    return prisma.bot.findMany({ orderBy: { createdAt: 'desc' } });
  }

  static async getBotById(id: string) {
    return prisma.bot.findUnique({ where: { id } });
  }

  static async createBot(data: { name: string; steamId: string; tradeUrl?: string; maxItems?: number }) {
    return prisma.bot.create({ data });
  }

  /** Quita de la tienda los ítems indexados de un bot (p. ej. al desactivarlo). */
  static async purgeStoreItemsForSteamId(steamId: string): Promise<number> {
    const result = await prisma.storeItem.deleteMany({
      where: { botSteamId: steamId },
    });
    if (result.count > 0) {
      console.log(
        `[BotService] ${result.count} StoreItem(s) eliminados para bot ${steamId}.`,
      );
    }
    return result.count;
  }

  /** Elimina StoreItems de bots inactivos (limpieza de datos viejos). */
  static async purgeStoreItemsForInactiveBots(): Promise<number> {
    const inactive = await prisma.bot.findMany({
      where: { isActive: false },
      select: { steamId: true },
    });
    if (inactive.length === 0) return 0;

    const result = await prisma.storeItem.deleteMany({
      where: { botSteamId: { in: inactive.map((b) => b.steamId) } },
    });
    if (result.count > 0) {
      console.log(
        `[BotService] Limpieza: ${result.count} StoreItem(s) de bots inactivos eliminados.`,
      );
    }
    return result.count;
  }

  /** Falla si algún StoreItem pertenece a un bot inactivo o desconocido. */
  static async assertStoreItemsFromActiveBots(
    items: { assetId: string; botSteamId: string }[],
  ): Promise<void> {
    if (items.length === 0) return;

    const activeSteamIds = new Set(
      (
        await prisma.bot.findMany({
          where: { isActive: true },
          select: { steamId: true },
        })
      ).map((b) => b.steamId),
    );

    const unavailable = items.filter((i) => !activeSteamIds.has(i.botSteamId));
    if (unavailable.length > 0) {
      throw new Error(
        `Some bot items are no longer available: ${unavailable.map((i) => i.assetId).join(", ")}`,
      );
    }
  }

  static async updateBot(id: string, data: { name?: string; tradeUrl?: string; status?: string; maxItems?: number; isActive?: boolean }) {
    const bot = await prisma.bot.update({
      where: { id },
      data,
    });
    if (data.isActive === false) {
      await this.purgeStoreItemsForSteamId(bot.steamId);
      await prisma.bot.update({
        where: { id },
        data: { currentItems: 0 },
      });
    }
    return bot;
  }

  static async deactivateBot(id: string) {
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) {
      throw new Error(`Bot ${id} no existe.`);
    }
    if (bot.steamId) {
      await this.purgeStoreItemsForSteamId(bot.steamId);
    }
    return prisma.bot.update({
      where: { id },
      data: { isActive: false, status: 'inactive', currentItems: 0 },
    });
  }

  static async activateBot(id: string) {
    return prisma.bot.update({
      where: { id },
      data: { isActive: true, status: 'active' }
    });
  }

  static async deleteBot(id: string) {
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (bot?.steamId) {
      await this.purgeStoreItemsForSteamId(bot.steamId);
    }
    return prisma.bot.delete({ where: { id } });
  }

  // Gets an available bot with capacity - filter in memory since Prisma doesn't support column-to-column comparison
  static async getAvailableBot() {
    const bots = await prisma.bot.findMany({
      where: { isActive: true, status: 'active' }
    });
    return bots.find(bot => bot.currentItems < bot.maxItems) || null;
  }

  static async updateInventoryCounts(countsBySteamId: Map<string, number>) {
    const bots = await prisma.bot.findMany();
    const now = new Date();

    await Promise.all(
      bots.map((bot) =>
        prisma.bot.update({
          where: { id: bot.id },
          data: {
            currentItems: countsBySteamId.get(bot.steamId) ?? 0,
            lastSyncAt: now,
          },
        }),
      ),
    );
  }
}
