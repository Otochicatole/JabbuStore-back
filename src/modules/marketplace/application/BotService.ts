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

  static async updateBot(id: string, data: { name?: string; tradeUrl?: string; status?: string; maxItems?: number; isActive?: boolean }) {
    return prisma.bot.update({
      where: { id },
      data
    });
  }

  static async deactivateBot(id: string) {
    return prisma.bot.update({
      where: { id },
      data: { isActive: false, status: 'inactive' }
    });
  }

  static async activateBot(id: string) {
    return prisma.bot.update({
      where: { id },
      data: { isActive: true, status: 'active' }
    });
  }

  static async deleteBot(id: string) {
    return prisma.bot.delete({ where: { id } });
  }

  // Gets an available bot with capacity - filter in memory since Prisma doesn't support column-to-column comparison
  static async getAvailableBot() {
    const bots = await prisma.bot.findMany({
      where: { isActive: true, status: 'active' }
    });
    return bots.find(bot => bot.currentItems < bot.maxItems) || null;
  }
}
