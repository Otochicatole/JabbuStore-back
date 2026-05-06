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
    await prisma.$transaction([
      prisma.storeItem.deleteMany(),
      prisma.storeItem.createMany({
        data: items,
      }),
    ]);
  }
}
