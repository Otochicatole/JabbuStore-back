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

  async updateUserInventoryPricesIfChanged(
    userId: string,
    items: UserInventoryItem[],
  ): Promise<number> {
    if (items.length === 0) return 0;

    const existingItems = await prisma.userInventoryItem.findMany({
      where: { userId },
      select: {
        assetId: true,
        price: true,
        name: true,
        paintIndex: true,
      },
    });
    const existingByAssetId = new Map(
      existingItems.map((item) => [item.assetId, item]),
    );

    const updates = items
      .map((item) => {
        const existing = existingByAssetId.get(item.assetId);
        if (!existing) return null;

        const nextPaintIndex = item.paintIndex ?? null;
        const priceChanged = Math.abs(existing.price - item.price) > 0.0001;
        const nameChanged = existing.name !== item.name;
        const paintIndexChanged = existing.paintIndex !== nextPaintIndex;

        if (!priceChanged && !nameChanged && !paintIndexChanged) {
          return null;
        }

        return prisma.userInventoryItem.update({
          where: { assetId: item.assetId },
          data: {
            price: item.price,
            name: item.name,
            paintIndex: nextPaintIndex,
          },
        });
      })
      .filter((update): update is NonNullable<typeof update> => update !== null);

    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }

    console.log(
      `[Prisma User Repository] User inventory prices updated: ${updates.length}/${items.length}`,
    );
    return updates.length;
  }
}
