import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IStoreRepository, StorePriceUpdate } from '../domain/IStoreRepository';
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
    // Fetch all existing items currently in the database to inspect manual overrides and deactivations
    const existing = await prisma.storeItem.findMany({
      where: {
        OR: [
          { isPriceManual: true },
          { marketable: false }
        ]
      }
    });

    const existingMap = new Map<string, typeof existing[0]>();
    for (const item of existing) {
      existingMap.set(item.assetId, item);
    }

    // Carry over manual prices and deactivation states
    const updatedItems = items.map(item => {
      const dbItem = existingMap.get(item.assetId);
      return {
        ...item,
        price: dbItem?.isPriceManual ? dbItem.price : (item.price ?? 0.0),
        isPriceManual: dbItem?.isPriceManual ?? false,
        marketable: dbItem?.marketable ?? true
      };
    });

    const sanitizedItems = updatedItems.map(item => ({
      assetId: item.assetId,
      classId: item.classId,
      name: item.name,
      type: item.type,
      iconUrl: item.iconUrl || null,
      tradable: item.tradable ?? true,
      marketable: item.marketable ?? true,
      botSteamId: item.botSteamId || "unknown",
      price: item.price ?? 0.0,
      isPriceManual: item.isPriceManual ?? false,
      rarity: item.rarity || "common",
      exterior: item.exterior || null,
      category: item.category || "other",
      isStatTrak: item.isStatTrak ?? false,
      isSouvenir: item.isSouvenir ?? false,
      float: (item.float !== undefined && item.float !== null && !isNaN(item.float)) ? item.float : null,
      pattern: (item.pattern !== undefined && item.pattern !== null && !isNaN(item.pattern)) ? Math.round(item.pattern) : null,
      paintIndex: (item.paintIndex !== undefined && item.paintIndex !== null && !isNaN(item.paintIndex)) ? Math.round(item.paintIndex) : null,
      inspectLink: item.inspectLink || null,
    }));

    // Chunk array into batches of 1000 items to bypass PostgreSQL parameter limit (max 65,535 parameters)
    const chunkSize = 1000;
    const batches: typeof sanitizedItems[] = [];
    for (let i = 0; i < sanitizedItems.length; i += chunkSize) {
      batches.push(sanitizedItems.slice(i, i + chunkSize));
    }

    console.log(`[Prisma Store Repository] Saving ${sanitizedItems.length} items in ${batches.length} chunks...`);
    await prisma.$transaction(
      async (tx) => {
        await tx.storeItem.deleteMany();
        for (let idx = 0; idx < batches.length; idx++) {
          const batch = batches[idx]!;
          await tx.storeItem.createMany({ data: batch });
        }
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  async updatePricesMany(updates: StorePriceUpdate[]): Promise<number> {
    let updated = 0;
    for (const entry of updates) {
      const existing = await prisma.storeItem.findUnique({
        where: { assetId: entry.assetId },
        select: { isPriceManual: true, price: true },
      });
      if (!existing || existing.isPriceManual) continue;

      await prisma.storeItem.update({
        where: { assetId: entry.assetId },
        data: {
          price: entry.price,
          name: entry.name,
        },
      });
      updated++;
    }
    console.log(
      `[Prisma Store Repository] Precios actualizados in-place: ${updated}/${updates.length}`,
    );
    return updated;
  }
}
