import { prisma } from '../../../shared/infrastructure/PrismaClient';

export class BotService {
  static async getAllBots() {
    return prisma.bot.findMany();
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

  // Gets an available bot with capacity
  static async getAvailableBot() {
    return prisma.bot.findFirst({
      where: {
        isActive: true,
        status: 'active',
        currentItems: { lt: prisma.bot.fields.maxItems }
      }
    });
  }
}
