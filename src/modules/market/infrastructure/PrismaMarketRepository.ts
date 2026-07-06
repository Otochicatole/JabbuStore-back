import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { config } from '../../../shared/config';
import { IMarketRepository } from '../domain/IMarketRepository';
import { MarketListing, MarketListingUpsert } from '../domain/MarketListing';
import { FloatItem } from '../domain/FloatItem';
import { MarketStoreAsset } from '../domain/MarketStoreAsset';
import { marketSyncProgressService } from '../application/MarketSyncProgressService';

function mapMarketListingRow(
  row: {
    id: string;
    name: string;
    provider: string;
    youpinAsk: number | null;
    youpinVolume: number | null;
    price: number;
    iconUrl: string | null;
    rarity: string;
    exterior: string | null;
    category: string;
    isStatTrak: boolean;
    isSouvenir: boolean;
    isPriceManual: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  priceOverride?: number,
): MarketListing {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as 'youpin',
    youpinAsk: row.youpinAsk,
    youpinVolume: row.youpinVolume,
    price: priceOverride ?? row.price,
    iconUrl: row.iconUrl,
    rarity: row.rarity,
    exterior: row.exterior,
    category: row.category,
    isStatTrak: row.isStatTrak,
    isSouvenir: row.isSouvenir,
    isPriceManual: row.isPriceManual,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Alineado con MARKET_SYNC_MIN_PRICE: 0 → solo oculta precio 0 en tienda. */
function storeMinPriceGt(): number {
  const min = config.marketSync.minPrice;
  return min > 0 ? min : 0;
}

export class PrismaMarketRepository implements IMarketRepository {
  async findAll(): Promise<MarketListing[]> {
    const rows = await prisma.marketListing.findMany({
      orderBy: { price: 'desc' },
    });

    return rows.map((row) => mapMarketListingRow(row));
  }

  async findAllForStore(): Promise<MarketListing[]> {
    const rows = await prisma.marketListing.findMany({
      where: {
        price: { gt: storeMinPriceGt() },
        floats: { some: { available: true } },
      },
      include: {
        floats: {
          where: { available: true },
          orderBy: { price: 'asc' },
          take: 1,
          select: { price: true },
        },
      },
      orderBy: { price: 'desc' },
    });

    return rows.map((row) => {
      const minFloatPrice = row.floats[0]?.price;
      return mapMarketListingRow(row, minFloatPrice ?? row.price);
    });
  }

  async findStoreAssets(): Promise<Omit<MarketStoreAsset, 'id'>[]> {
    const rows = await prisma.floatItem.findMany({
      where: {
        available: true,
        price: { gt: storeMinPriceGt() },
      },
      include: { resaleItem: true },
      orderBy: { price: 'asc' },
    });

    return rows.map((row) => ({
      floatItemId: row.id,
      assetId: row.assetId,
      listingId: row.resaleItemId,
      name: row.resaleItem.name,
      provider: 'youpin' as const,
      youpinAsk: row.resaleItem.youpinAsk,
      youpinVolume: row.resaleItem.youpinVolume,
      price: row.price,
      floatValue: row.floatValue,
      paintSeed: row.paintSeed,
      inspectLink: row.inspectLink,
      externalId: row.externalId,
      iconUrl: row.resaleItem.iconUrl,
      rarity: row.resaleItem.rarity,
      exterior: row.resaleItem.exterior,
      category: row.resaleItem.category,
      isStatTrak: row.resaleItem.isStatTrak,
      isSouvenir: row.resaleItem.isSouvenir,
    }));
  }

  async findAllWithAvailableFloats(): Promise<MarketListing[]> {
    const rows = await prisma.marketListing.findMany({
      where: {
        floats: {
          some: { available: true },
        },
      },
      include: {
        floats: {
          where: { available: true },
          orderBy: { price: 'asc' },
          take: 1,
          select: { price: true },
        },
      },
      orderBy: { price: 'desc' },
    });

    return rows.map((row) => {
      const minFloatPrice = row.floats[0]?.price;
      return mapMarketListingRow(row, minFloatPrice ?? row.price);
    });
  }

  async replaceAll(listings: MarketListingUpsert[]): Promise<void> {
    // 1. Preservar precios manuales antes de limpiar
    const manualPrices = await prisma.marketListing.findMany({
      where: { isPriceManual: true },
      select: { name: true, price: true },
    });
    const manualMap = new Map(manualPrices.map((m) => [m.name, m.price]));

    // 2. Eliminar todas las listings automáticas existentes (no manuales)
    // Esto disparará cascade delete de sus FloatItems en cascada
    const deletedCount = await prisma.marketListing.deleteMany({
      where: { isPriceManual: false },
    });
    console.log(
      `[Prisma Market Repository] Eliminadas ${deletedCount.count} listings automáticas obsoletas antes de re-importar.`,
    );

    // 3. Construir lista sanitizada con precios manuales aplicados
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

    const manualNames = new Set(manualMap.keys());
    const manualCount = sanitized.filter((s) => manualNames.has(s.name)).length;
    const autoCount = sanitized.length - manualCount;

    // Reportar inicio de guardado en base de datos
    marketSyncProgressService.startDatabaseSave(sanitized.length);

    const upsertOne = (listing: (typeof sanitized)[number]) => {
      const isManual = manualNames.has(listing.name);
      return prisma.marketListing.upsert({
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
          ...(isManual ? {} : { price: listing.price }),
        },
      });
    };

    const parallelSize = 10;
    console.log(
      `[Prisma Market Repository] Guardando ${sanitized.length} listings (${parallelSize} en paralelo)...`,
    );

    for (let i = 0; i < sanitized.length; i += parallelSize) {
      const batch = sanitized.slice(i, i + parallelSize);
      await Promise.all(batch.map((listing) => upsertOne(listing)));

      const done = Math.min(i + parallelSize, sanitized.length);
      marketSyncProgressService.updateDatabaseProgress(done);
      if (done % 1000 === 0 || done === sanitized.length) {
        console.log(
          `[Prisma Market Repository] Progreso: ${done}/${sanitized.length}`,
        );
      }
    }

    console.log(
      `[Prisma Market Repository] Sync completo: ${autoCount} automáticos creados, ${manualCount} manuales actualizados/preservados.`,
    );
  }

  async syncCatalogWithFloats(
    listings: MarketListingUpsert[],
    floatsByName: Map<string, Omit<FloatItem, 'resaleItemId'>[]>,
  ): Promise<void> {
    await this.replaceAll(listings);

    const names = listings.map((l) => l.name);
    const rows = await prisma.marketListing.findMany({
      where: { name: { in: names } },
      select: { id: true, name: true },
    });

    console.log(
      `[Prisma Market Repository] Guardando floats para ${rows.length} listings...`,
    );

    for (const row of rows) {
      const floatRows = floatsByName.get(row.name) ?? [];
      if (floatRows.length === 0) continue;

      await this.saveFloats(
        row.id,
        floatRows.map((f) => ({
          ...f,
          resaleItemId: row.id,
        })),
      );
    }

    const orphanCleanup = await prisma.marketListing.deleteMany({
      where: {
        isPriceManual: false,
        floats: { none: {} },
      },
    });
    if (orphanCleanup.count > 0) {
      console.log(
        `[Prisma Market Repository] ${orphanCleanup.count} listings sin floats eliminados.`,
      );
    }
  }

  async updatePrice(id: string, price: number): Promise<void> {
    await prisma.marketListing.update({
      where: { id },
      data: { price, isPriceManual: true },
    });
  }

  async syncListingPriceFromFloats(resaleItemId: string): Promise<void> {
    const minFloat = await prisma.floatItem.findFirst({
      where: { resaleItemId, available: true, price: { gt: 0 } },
      orderBy: { price: 'asc' },
      select: { price: true },
    });
    if (!minFloat) return;

    await prisma.marketListing.updateMany({
      where: { id: resaleItemId, isPriceManual: false },
      data: { price: minFloat.price, youpinAsk: minFloat.price },
    });
  }

  async saveFloats(resaleItemId: string, floats: FloatItem[]): Promise<void> {
    // Marcar el intento de sync aunque no se encuentren floats (para no reintentar en vano).
    const markAttempt = prisma.marketListing
      .update({
        where: { id: resaleItemId },
        data: { floatsSyncedAt: new Date() },
      })
      .catch(() => undefined);

    if (floats.length === 0) {
      await markAttempt;
      return;
    }

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
    await this.syncListingPriceFromFloats(resaleItemId);
    await markAttempt;
  }

  async findFloatEligibleForReindex(
    limit: number,
  ): Promise<{ id: string; name: string }[]> {
    // Ítems con desgaste (skins/cuchillos/guantes = elegibles para float),
    // priorizando los nunca intentados (floatsSyncedAt null) y luego los más desactualizados.
    return prisma.marketListing.findMany({
      where: { NOT: { exterior: null } },
      select: { id: true, name: true },
      orderBy: [
        { floatsSyncedAt: { sort: 'asc', nulls: 'first' } },
        { price: 'desc' },
      ],
      take: limit,
    });
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
      market: row.market as 'YOUPIN' | 'CSFLOAT',
      price: row.price,
      inspectLink: row.inspectLink,
      available: row.available,
      externalId: row.externalId,
      lastSyncAt: row.lastSyncAt,
      resaleItemId: row.resaleItemId,
    }));
  }
}
