import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IUserRepository, User, UserInventoryItem } from '../domain/User';

export class PrismaUserRepository implements IUserRepository {
  async save(user: any): Promise<User> {
    if (user.id) {
      const { id, ...data } = user;
      return prisma.user.update({
        where: { id },
        data,
      }) as any;
    }
    return prisma.user.create({
      data: user,
    }) as any;
  }

  async findAll(): Promise<User[]> {
    return prisma.user.findMany() as any;
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    }) as any;
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    }) as any;
  }

  async findBySteamId(steamId: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { steamId },
    }) as any;
  }

  async getUserInventory(userId: string): Promise<UserInventoryItem[]> {
    return prisma.userInventoryItem.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    }) as any;
  }

  async saveUserInventory(userId: string, items: UserInventoryItem[]): Promise<void> {
    await prisma.$transaction([
      prisma.userInventoryItem.deleteMany({
        where: { userId },
      }),
      prisma.userInventoryItem.createMany({
        data: items,
      }),
    ]);
  }
}
