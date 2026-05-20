import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IStoreRepository } from '../domain/IStoreRepository';
import { StoreItem } from '../domain/Item';

export class PrismaStoreRepository implements IStoreRepository {
  async findAll(): Promise<StoreItem[]> {
    return prisma.storeItem.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async clearAndSaveMany(items: StoreItem[]): Promise<void> {
    // Fetch all existing items currently in the database to inspect manual overrides
    const existing = await prisma.storeItem.findMany({
      where: { isPriceManual: true }
    });

    const manualMap = new Map<string, typeof existing[0]>();
    for (const item of existing) {
      manualMap.set(item.assetId, item);
    }

    // Carry over manual prices for items that are still in the synced bot inventory list
    const updatedItems = items.map(item => {
      const manualItem = manualMap.get(item.assetId);
      if (manualItem) {
        return {
          ...item,
          price: manualItem.price,
          isPriceManual: true
        };
      }
      return {
        ...item,
        isPriceManual: false
      };
    });

    await prisma.$transaction([
      prisma.storeItem.deleteMany(),
      prisma.storeItem.createMany({
        data: updatedItems as any,
      }),
    ]);
  }
}
