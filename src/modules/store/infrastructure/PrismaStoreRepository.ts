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

    // Sanitize objects to guarantee no undefined values are passed to Prisma
    const sanitizedItems = updatedItems.map(item => ({
      assetId: item.assetId,
      classId: item.classId,
      name: item.name,
      type: item.type,
      iconUrl: item.iconUrl || null,
      tradable: item.tradable ?? true,
      marketable: item.marketable ?? true,
      botSteamId: item.botSteamId || "resell_market",
      price: item.price ?? 0.0,
      isImmediate: item.isImmediate ?? true,
      isPriceManual: item.isPriceManual ?? false,
      rarity: item.rarity || "common",
      exterior: item.exterior || null,
      category: item.category || "other",
      isStatTrak: item.isStatTrak ?? false,
      isSouvenir: item.isSouvenir ?? false,
      float: (item.float !== undefined && item.float !== null && !isNaN(item.float)) ? item.float : null,
      pattern: (item.pattern !== undefined && item.pattern !== null && !isNaN(item.pattern)) ? Math.round(item.pattern) : null,
    }));

    // Chunk array into batches of 1000 items to bypass PostgreSQL parameter limit (max 65,535 parameters)
    const chunkSize = 1000;
    const batches: typeof sanitizedItems[] = [];
    for (let i = 0; i < sanitizedItems.length; i += chunkSize) {
      batches.push(sanitizedItems.slice(i, i + chunkSize));
    }

    await prisma.storeItem.deleteMany();
    
    console.log(`[Prisma Store Repository] Saving ${sanitizedItems.length} items in ${batches.length} chunks...`);
    for (let idx = 0; idx < batches.length; idx++) {
      const batch = batches[idx]!;
      await prisma.storeItem.createMany({
        data: batch,
      });
    }
  }
}
