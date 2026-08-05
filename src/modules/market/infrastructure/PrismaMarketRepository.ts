import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { createHash } from 'node:crypto';
import { IMarketRepository } from '../domain/IMarketRepository';
import { FloatItem } from '../domain/FloatItem';

/** Stable across snapshot publications, which keeps cart references deterministic. */
export function stableMarketFloatId(market: string, assetId: string): string {
  return createHash('sha256')
    .update(`${market.trim().toLowerCase()}:${assetId.trim()}`)
    .digest('hex');
}

export class PrismaMarketRepository implements IMarketRepository {
  async saveFloats(listingId: string, floats: FloatItem[]): Promise<void> {
    if (floats.length === 0) {
      return;
    }

    await prisma.$transaction([
      prisma.floatItem.deleteMany({
        where: { listingId }
      }),
      prisma.floatItem.createMany({
        data: floats.map((f) => ({
          id: f.id ?? stableMarketFloatId(f.market, f.assetId),
          assetId: f.assetId,
          floatValue: f.floatValue,
          paintSeed: f.paintSeed,
          market: f.market,
          price: f.price,
          inspectLink: f.inspectLink || null,
          available: f.available ?? true,
          externalId: f.externalId || null,
          lastSyncAt: f.lastSyncAt || new Date(),
          listingId: listingId,
        }))
      })
    ]);
  }

  async findFloatsByListingId(listingId: string): Promise<FloatItem[]> {
    const rows = await prisma.floatItem.findMany({
      where: { listingId },
      orderBy: { price: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      assetId: row.assetId,
      floatValue: row.floatValue,
      paintSeed: row.paintSeed,
      market: row.market as 'YOUPIN' | 'CSFLOAT',
      price: row.price,
      inspectLink: row.inspectLink,
      available: row.available,
      externalId: row.externalId,
      lastSyncAt: row.lastSyncAt,
      listingId: row.listingId,
    }));
  }

  async invalidateAbsentFloats(
    listingId: string,
    presentAssetIds: string[],
  ): Promise<number> {
    const result = await prisma.floatItem.updateMany({
      where: {
        listingId,
        market: 'YOUPIN',
        available: true,
        ...(presentAssetIds.length > 0
          ? { assetId: { notIn: presentAssetIds } }
          : {}),
      },
      data: { available: false },
    });
    return result.count;
  }
}
