import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IMarketRepository } from '../domain/IMarketRepository';
import { MarketListing, MarketListingUpsert } from '../domain/MarketListing';
import { FloatItem } from '../domain/FloatItem';

export class PrismaMarketRepository implements IMarketRepository {
  async findAll(): Promise<MarketListing[]> {
    const rows = await prisma.marketListing.findMany({
      orderBy: { price: 'desc' },
    });

    return rows.map((row) => ({
      ...row,
      provider: row.provider as 'youpin',
    }));
  }

  async replaceAll(listings: MarketListingUpsert[]): Promise<void> {
    // Preservar precios manuales antes de limpiar
    const manualPrices = await prisma.marketListing.findMany({
      where: { isPriceManual: true },
      select: { name: true, price: true },
    });
    const manualMap = new Map(manualPrices.map((m) => [m.name, m.price]));

    // Construir lista sanitizada con precios manuales aplicados
    const sanitized = listings.map((listing) => {
      const manualPrice = manualMap.get(listing.name);
      return {
        name: listing.name,
        provider: listing.provider,
        youpinAsk: listing.youpinAsk,
        youpinVolume: listing.youpinVolume,
        price: manualPrice ?? listing.price,
        iconUrl: listing.iconUrl ?? null,
        rarity: listing.rarity || 'common',
        exterior: listing.exterior ?? null,
        category: listing.category || 'other',
        isStatTrak: listing.isStatTrak ?? false,
        isSouvenir: listing.isSouvenir ?? false,
        isPriceManual: manualPrice != null,
      };
    });

    // Separar entre los que tienen precio manual (update individual) y los que no (delete+create)
    const manualNames = new Set(manualMap.keys());
    const nonManualToSave = sanitized.filter(s => !manualNames.has(s.name));
    const manualToUpdate = sanitized.filter(s => manualNames.has(s.name));

    // 1. Eliminar todos los listings no-manuales actuales de una sola pasada
    await prisma.marketListing.deleteMany({ where: { isPriceManual: false } });

    // 2. Insertar los nuevos listings no-manuales en lotes de 500
    const chunkSize = 500;
    console.log(`[Prisma Market Repository] Insertando ${nonManualToSave.length} listings en lotes de ${chunkSize}...`);
    for (let i = 0; i < nonManualToSave.length; i += chunkSize) {
      const batch = nonManualToSave.slice(i, i + chunkSize);
      await prisma.marketListing.createMany({ data: batch, skipDuplicates: true });
    }

    // 3. Actualizar los listings con precio manual de forma individual (son pocos)
    for (const listing of manualToUpdate) {
      await prisma.marketListing.upsert({
        where: { name: listing.name },
        create: listing,
        update: {
          provider: listing.provider,
          youpinAsk: listing.youpinAsk,
          youpinVolume: listing.youpinVolume,
          iconUrl: listing.iconUrl,
          rarity: listing.rarity,
          exterior: listing.exterior,
          category: listing.category,
          isStatTrak: listing.isStatTrak,
          isSouvenir: listing.isSouvenir,
          // NO actualizar price ni isPriceManual — son manuales
        },
      });
    }

    console.log(`[Prisma Market Repository] Sync completo: ${nonManualToSave.length} insertados, ${manualToUpdate.length} manuales preservados.`);
  }

  async updatePrice(id: string, price: number): Promise<void> {
    await prisma.marketListing.update({
      where: { id },
      data: { price, isPriceManual: true },
    });
  }

  async saveFloats(resaleItemId: string, floats: FloatItem[]): Promise<void> {
    await prisma.$transaction([
      prisma.floatItem.deleteMany({
        where: { resaleItemId }
      }),
      prisma.floatItem.createMany({
        data: floats.map((f) => ({
          assetId: f.assetId,
          floatValue: f.floatValue,
          paintSeed: f.paintSeed,
          market: f.market,
          price: f.price,
          inspectLink: f.inspectLink || null,
          available: f.available ?? true,
          externalId: f.externalId || null,
          lastSyncAt: f.lastSyncAt || new Date(),
          resaleItemId: resaleItemId,
        }))
      })
    ]);
  }

  async findFloatsByResaleItemId(resaleItemId: string): Promise<FloatItem[]> {
    const rows = await prisma.floatItem.findMany({
      where: { resaleItemId },
      orderBy: { price: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      assetId: row.assetId,
      floatValue: row.floatValue,
      paintSeed: row.paintSeed,
      market: row.market as 'YOUPIN',
      price: row.price,
      inspectLink: row.inspectLink,
      available: row.available,
      externalId: row.externalId,
      lastSyncAt: row.lastSyncAt,
      resaleItemId: row.resaleItemId,
    }));
  }
}
