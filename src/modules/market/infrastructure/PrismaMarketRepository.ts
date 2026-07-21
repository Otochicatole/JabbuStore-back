import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { createHash } from 'node:crypto';
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

/** Stable across snapshot publications, which keeps cart references deterministic. */
export function stableMarketFloatId(market: string, assetId: string): string {
  return createHash('sha256')
    .update(`${market.trim().toLowerCase()}:${assetId.trim()}`)
    .digest('hex');
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

  async syncCatalogSliceWithFloats(
    listings: MarketListingUpsert[],
    floatsByName: Map<string, Omit<FloatItem, 'resaleItemId'>[]>,
    emptyListingNames: string[],
  ): Promise<void> {
    const listingNames = listings.map((listing) => listing.name);
    const listingNameSet = new Set(listingNames);
    const emptyNames = [...new Set(emptyListingNames)].filter(
      (name) => name && !listingNameSet.has(name),
    );
    const totalTouched = listings.length + emptyNames.length;

    if (totalTouched === 0) return;

    marketSyncProgressService.startDatabaseSave(totalTouched);

    const manualPrices =
      listingNames.length > 0
        ? await prisma.marketListing.findMany({
            where: { name: { in: listingNames }, isPriceManual: true },
            select: { name: true, price: true },
          })
        : [];
    const manualMap = new Map(manualPrices.map((m) => [m.name, m.price]));

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

    const parallelSize = 10;
    let processed = 0;

    for (let i = 0; i < sanitized.length; i += parallelSize) {
      const batch = sanitized.slice(i, i + parallelSize);
      await Promise.all(
        batch.map((listing) => {
          const isManual = manualMap.has(listing.name);
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
        }),
      );

      processed += batch.length;
      marketSyncProgressService.updateDatabaseProgress(processed);
    }

    if (listingNames.length > 0) {
      const rows = await prisma.marketListing.findMany({
        where: { name: { in: listingNames } },
        select: { id: true, name: true },
      });

      for (const row of rows) {
        const floatRows = floatsByName.get(row.name) ?? [];
        await this.saveFloats(
          row.id,
          floatRows.map((floatRow) => ({
            ...floatRow,
            resaleItemId: row.id,
          })),
        );
      }
    }

    if (emptyNames.length > 0) {
      const emptyRows = await prisma.marketListing.findMany({
        where: { name: { in: emptyNames } },
        select: { id: true },
      });
      const ids = emptyRows.map((row) => row.id);

      if (ids.length > 0) {
        await prisma.$transaction([
          prisma.floatItem.deleteMany({
            where: { resaleItemId: { in: ids } },
          }),
          prisma.marketListing.updateMany({
            where: { id: { in: ids } },
            data: {
              youpinAsk: null,
              youpinVolume: 0,
              floatsSyncedAt: new Date(),
            },
          }),
          prisma.marketListing.updateMany({
            where: { id: { in: ids }, isPriceManual: false },
            data: { price: 0 },
          }),
        ]);
      }

      processed += emptyNames.length;
      marketSyncProgressService.updateDatabaseProgress(processed);
    }
  }

  async replaceAutomaticCatalogWithFloats(
    listings: MarketListingUpsert[],
    floatsByName: Map<string, Omit<FloatItem, 'resaleItemId'>[]>,
  ): Promise<void> {
    const names = listings.map((listing) => listing.name);
    const uniqueNames = new Set(names);
    if (uniqueNames.size !== names.length) {
      throw new Error('El snapshot contiene nombres de listing duplicados.');
    }

    const seenAssets = new Set<string>();
    for (const [name, floats] of floatsByName) {
      if (!uniqueNames.has(name)) {
        throw new Error(`El snapshot contiene assets para un listing inexistente: ${name}`);
      }
      for (const floatItem of floats) {
        const assetKey = `${floatItem.market}:${floatItem.assetId}`.toUpperCase();
        if (seenAssets.has(assetKey)) {
          throw new Error(`El snapshot contiene un asset duplicado: ${floatItem.assetId}`);
        }
        seenAssets.add(assetKey);
      }
    }

    const now = new Date();
    marketSyncProgressService.startDatabaseSave(listings.length);

    await prisma.$transaction(
      async (tx) => {
        const manualRows = await tx.marketListing.findMany({
          where: { isPriceManual: true },
          select: { id: true, name: true },
        });
        const manualByName = new Map(manualRows.map((row) => [row.name, row]));

        // Only YouPin provider data belongs to this snapshot. Other market assets
        // and manual listings are deliberately left intact.
        await tx.floatItem.deleteMany({ where: { market: 'YOUPIN' } });
        await tx.marketListing.deleteMany({
          where: { provider: 'youpin', isPriceManual: false },
        });
        await tx.marketListing.updateMany({
          where: { provider: 'youpin', isPriceManual: true },
          data: {
            youpinAsk: null,
            youpinVolume: 0,
            floatsSyncedAt: now,
          },
        });

        const automaticRows = listings
          .filter((listing) => !manualByName.has(listing.name))
          .map((listing) => ({
            name: listing.name,
            provider: listing.provider,
            youpinAsk: listing.youpinAsk,
            youpinVolume: listing.youpinVolume,
            price: listing.price,
            iconUrl: listing.iconUrl,
            rarity: listing.rarity || 'common',
            exterior: listing.exterior,
            category: listing.category || 'other',
            isStatTrak: listing.isStatTrak,
            isSouvenir: listing.isSouvenir,
            isPriceManual: false,
            floatsSyncedAt: now,
          }));

        for (let index = 0; index < automaticRows.length; index += 400) {
          await tx.marketListing.createMany({
            data: automaticRows.slice(index, index + 400),
          });
          marketSyncProgressService.updateDatabaseProgress(
            Math.min(index + 400, automaticRows.length),
          );
        }

        // A manual listing included in the new snapshot keeps its price and ID,
        // while all provider metadata and its live assets are refreshed.
        for (const listing of listings) {
          const manual = manualByName.get(listing.name);
          if (!manual) continue;
          await tx.marketListing.update({
            where: { id: manual.id },
            data: {
              youpinAsk: listing.youpinAsk,
              youpinVolume: listing.youpinVolume,
              iconUrl: listing.iconUrl,
              rarity: listing.rarity || 'common',
              exterior: listing.exterior,
              category: listing.category || 'other',
              isStatTrak: listing.isStatTrak,
              isSouvenir: listing.isSouvenir,
              floatsSyncedAt: now,
            },
          });
        }

        const persistedListings = await tx.marketListing.findMany({
          where: { name: { in: names } },
          select: { id: true, name: true },
        });
        const listingIdByName = new Map(
          persistedListings.map((listing) => [listing.name, listing.id]),
        );

        const floatRows = listings.flatMap((listing) => {
          const resaleItemId = listingIdByName.get(listing.name);
          if (!resaleItemId) {
            throw new Error(`No se pudo persistir el listing ${listing.name}.`);
          }
          return (floatsByName.get(listing.name) ?? []).map((floatItem) => ({
            id: stableMarketFloatId('YOUPIN', floatItem.assetId),
            assetId: floatItem.assetId,
            floatValue: floatItem.floatValue,
            paintSeed: floatItem.paintSeed,
            market: 'YOUPIN',
            price: floatItem.price,
            inspectLink: floatItem.inspectLink ?? null,
            available: true,
            externalId: floatItem.externalId ?? null,
            lastSyncAt: now,
            resaleItemId,
          }));
        });

        for (let index = 0; index < floatRows.length; index += 400) {
          await tx.floatItem.createMany({
            data: floatRows.slice(index, index + 400),
          });
        }

        marketSyncProgressService.updateDatabaseProgress(listings.length);
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
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
