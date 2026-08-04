import type { FloatItem } from '../domain/FloatItem';
import type { IMarketRepository } from '../domain/IMarketRepository';
import { stableMarketFloatId } from '../infrastructure/PrismaMarketRepository';
import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { FloatCachePolicy } from './FloatCachePolicy';
import { YoupinFloatAssetsDownloader } from './YoupinFloatAssetsDownloader';
import { MarketPricingService } from './MarketPricingService';

export interface ListingFloatItem {
  id: string;
  assetId: string;
  floatValue: number;
  paintSeed: number;
  price: number;
  displayPrice: number;
  inspectLink: string | null;
  externalId: string | null;
  available: boolean;
  lastSyncAt: Date | null;
}

export interface GetOrRefreshFloatsResult {
  floats: ListingFloatItem[];
  total: number;
  fromCache: boolean;
  floatsSyncedAt: Date | null;
  refreshFailed: boolean;
  refreshError: string | null;
}

export interface GetOrRefreshFloatsOptions {
  sortBy?: 'float_asc' | 'float_desc' | 'price_asc' | 'price_desc';
  floatMin?: number;
  floatMax?: number;
  paintSeed?: number;
  limit?: number;
  offset?: number;
  forceRefresh?: boolean;
}

// Single-flight: evita consultas simultaneas a la misma skin
const inflight = new Map<string, Promise<{ floatsSyncedAt: Date | null; error: string | null }>>();

/**
 * Proceso 2: Carga diferida de assets para un MarketListing.
 *
 * - Verifica cache via FloatCachePolicy.
 * - Si stale o null: descarga paginada via YoupinFloatAssetsDownloader.
 * - Implementa single-flight por listingId.
 * - Upsert de FloatItem + invalida ausentes solo si la descarga es completa.
 * - Actualiza floatsSyncedAt solo tras exito.
 * - En caso de error con cache existente: devuelve cache + refreshFailed = true.
 */
export class GetOrRefreshListingFloatsUseCase {
  constructor(
    private readonly marketRepository: IMarketRepository,
    private readonly cachePolicy: FloatCachePolicy,
    private readonly downloader: YoupinFloatAssetsDownloader,
  ) {}

  async execute(
    listingId: string,
    options: GetOrRefreshFloatsOptions = {},
  ): Promise<GetOrRefreshFloatsResult> {
    // 1. Validar listing
    const listing = await this.marketRepository.findById(listingId);
    if (!listing) {
      throw new Error(`MarketListing con ID "${listingId}" no existe.`);
    }
    if (listing.provider !== 'youpin') {
      throw new Error(`El listing "${listingId}" no es de YouPin (provider=${listing.provider}).`);
    }

    // 2. Verificar si hay datos en DB
    const existingCount = await prisma.floatItem.count({
      where: { resaleItemId: listingId, market: 'YOUPIN', available: true },
    });

    const needsRefresh = options.forceRefresh || this.cachePolicy.shouldRefresh(listing.floatsSyncedAt);
    let refreshFailed = false;
    let refreshError: string | null = null;
    let floatsSyncedAt = listing.floatsSyncedAt;

    if (needsRefresh) {
      // Single-flight
      let refreshPromise = inflight.get(listingId);

      if (!refreshPromise) {
        refreshPromise = this.refreshFloats(listingId, listing.name).finally(() => {
          inflight.delete(listingId);
        });
        inflight.set(listingId, refreshPromise);
      }

      if (existingCount > 0) {
        // Stale-While-Revalidate: si ya tenemos datos en DB, los devolvemos INMEDIATAMENTE
        // y dejamos la sincronización corriendo en segundo plano sin bloquear al usuario.
        console.log(
          `[GetOrRefreshFloats] listingId=${listingId}: Sirviendo ${existingCount} floats desde DB (refresh en background)`,
        );
        // Capturamos cualquier error en background sin tumbar la petición
        refreshPromise.catch((err) =>
          console.error(`[GetOrRefreshFloats] Background refresh error for ${listingId}:`, err),
        );
      } else {
        // Si no hay ningún float en DB, esperamos con un timeout máximo de 6s para no congelar HTTP
        try {
          const timeoutPromise = new Promise<{ floatsSyncedAt: Date | null; error: string }>((_, reject) =>
            setTimeout(() => reject(new Error('Tiempo de espera agotado al descargar floats (timeout 6s)')), 6000),
          );
          const refreshResult = await Promise.race([refreshPromise, timeoutPromise]);
          floatsSyncedAt = refreshResult.floatsSyncedAt;
          if (refreshResult.error) {
            refreshFailed = true;
            refreshError = refreshResult.error;
          }
        } catch (err: any) {
          console.warn(`[GetOrRefreshFloats] listingId=${listingId}: Timeout/error esperando descarga inicial: ${err.message}`);
          refreshFailed = true;
          refreshError = err.message;
        }
      }
    }

    // 4. Consultar BD
    const { sortBy = 'float_asc', floatMin, floatMax, paintSeed, limit = 50, offset = 0 } = options;

    const where: any = {
      resaleItemId: listingId,
      market: 'YOUPIN',
      available: true,
    };

    if (floatMin != null && floatMax != null) {
      where.floatValue = { gte: floatMin, lte: floatMax };
    } else if (floatMin != null) {
      where.floatValue = { gte: floatMin };
    } else if (floatMax != null) {
      where.floatValue = { lte: floatMax };
    }

    if (paintSeed != null) {
      where.paintSeed = paintSeed;
    }

    const orderBy = sortByToOrderBy(sortBy);

    const [rows, total] = await Promise.all([
      prisma.floatItem.findMany({ where, orderBy, take: limit, skip: offset }),
      prisma.floatItem.count({ where }),
    ]);

    // 5. Calcular displayPrice
    const settings = await prisma.adminSettings.findFirst();
    const modSettings = settings
      ? {
          marketModifierEnabled: settings.marketModifierEnabled,
          marketModifierType: settings.marketModifierType,
          marketModifierValue: settings.marketModifierValue,
        }
      : MarketPricingService.defaultSettings();

    const floats: ListingFloatItem[] = rows.map((row) => ({
      id: row.id,
      assetId: row.assetId,
      floatValue: row.floatValue,
      paintSeed: row.paintSeed,
      price: row.price,
      displayPrice: MarketPricingService.applyModifier(row.price, modSettings),
      inspectLink: row.inspectLink,
      externalId: row.externalId,
      available: row.available,
      lastSyncAt: row.lastSyncAt,
    }));

    return {
      floats,
      total,
      fromCache: !needsRefresh || refreshFailed,
      floatsSyncedAt,
      refreshFailed,
      refreshError,
    };
  }

  private async refreshFloats(
    listingId: string,
    marketHashName: string,
  ): Promise<{ floatsSyncedAt: Date | null; error: string | null }> {
    try {
      const result = await this.downloader.download(listingId, marketHashName);

      if (result.error && !result.complete) {
        // Descarga incompleta o fallida: NO invalidar assets anteriores
        console.warn(
          `[GetOrRefreshFloats] Descarga incompleta para listingId=${listingId}: ${result.error}`,
        );
        return { floatsSyncedAt: null, error: result.error };
      }

      // Upsert de los floats recibidos
      if (result.floats.length > 0) {
        const now = new Date();
        for (const f of result.floats) {
          const id = stableMarketFloatId('YOUPIN', f.assetId);
          await prisma.floatItem.upsert({
            where: { id },
            create: {
              id,
              assetId: f.assetId,
              floatValue: f.floatValue,
              paintSeed: f.paintSeed,
              market: 'YOUPIN',
              price: f.price,
              inspectLink: f.inspectLink ?? null,
              available: true,
              externalId: f.externalId ?? null,
              lastSyncAt: now,
              resaleItemId: listingId,
            },
            update: {
              floatValue: f.floatValue,
              paintSeed: f.paintSeed,
              price: f.price,
              inspectLink: f.inspectLink ?? null,
              available: true,
              externalId: f.externalId ?? null,
              lastSyncAt: now,
            },
          });
        }
      }

      // Invalidar assets ausentes SOLO si la descarga fue completa
      let invalidated = 0;
      if (result.complete) {
        invalidated = await this.marketRepository.invalidateAbsentFloats(
          listingId,
          result.presentAssetIds,
        );
        if (invalidated > 0) {
          console.log(
            `[GetOrRefreshFloats] listingId=${listingId}: ${invalidated} assets marcados unavailable`,
          );
        }
      }

      // Actualizar floatsSyncedAt SOLO si la descarga fue exitosa
      const syncedAt = new Date();
      await this.marketRepository.updateListingFloatsSyncedAt(listingId, syncedAt);

      console.log(
        `[GetOrRefreshFloats] listingId=${listingId} "${marketHashName}": ` +
          `${result.validAssets} floats, ${invalidated} invalidados, complete=${result.complete}`,
      );

      return { floatsSyncedAt: syncedAt, error: null };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[GetOrRefreshFloats] Error al refrescar listingId=${listingId}: ${errorMsg}`,
      );
      return { floatsSyncedAt: null, error: errorMsg };
    }
  }
}

function sortByToOrderBy(
  sortBy: string,
): { floatValue?: 'asc' | 'desc'; price?: 'asc' | 'desc' } {
  switch (sortBy) {
    case 'float_desc': return { floatValue: 'desc' };
    case 'price_asc': return { price: 'asc' };
    case 'price_desc': return { price: 'desc' };
    case 'float_asc':
    default:
      return { floatValue: 'asc' };
  }
}