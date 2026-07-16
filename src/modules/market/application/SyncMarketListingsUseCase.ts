import { IMarketRepository } from "../domain/IMarketRepository";
import { IMarketSyncStateRepository } from "../domain/IMarketSyncStateRepository";
import { config } from "../../../shared/config";
import {
  CatalogGroup,
  groupYoupinAssetsIntoCatalog,
} from "./floatCatalogMapper";
import { marketSyncProgressService } from "./MarketSyncProgressService";
import { MarketPriorityDiscoveryQueue } from "./MarketPriorityDiscoveryQueue";
import { SyncResaleItemFloatsUseCase } from "./SyncResaleItemFloatsUseCase";

const MARKET_SYNC_STATE_KEY = "youpin-price-priority";

function advanceCursor(cursor: number, length: number): number {
  if (length <= 0) return 0;
  return (cursor + 1) % length;
}

function clampCursor(cursor: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(cursor) || cursor < 0) return 0;
  return cursor >= length ? 0 : Math.trunc(cursor);
}

function mergeCatalogGroups(
  target: Map<string, CatalogGroup>,
  source: Map<string, CatalogGroup>,
): void {
  for (const [name, incoming] of source.entries()) {
    const existing = target.get(name);
    if (!existing) {
      target.set(name, {
        listing: { ...incoming.listing },
        floats: [...incoming.floats],
      });
      continue;
    }

    existing.floats.push(...incoming.floats);
    existing.listing.youpinVolume =
      (existing.listing.youpinVolume ?? 0) +
      (incoming.listing.youpinVolume ?? 0);

    if (incoming.listing.price < existing.listing.price) {
      existing.listing.price = incoming.listing.price;
      existing.listing.youpinAsk = incoming.listing.youpinAsk;
      if (incoming.listing.iconUrl) {
        existing.listing.iconUrl = incoming.listing.iconUrl;
      }
    }

    if (!existing.listing.iconUrl && incoming.listing.iconUrl) {
      existing.listing.iconUrl = incoming.listing.iconUrl;
    }
  }
}

/**
 * Sincroniza el catálogo YouPin consultando float/assets por market_hash_name.
 * El orden de consulta sale del JSON local de /steam/api/items usado por bots:
 * items caros primero, sin usar ese precio como precio de venta.
 */
export class SyncMarketListingsUseCase {
  private floatSyncUseCase: SyncResaleItemFloatsUseCase;

  constructor(
    private marketRepository: IMarketRepository,
    private syncStateRepository: IMarketSyncStateRepository,
    private priorityQueue = new MarketPriorityDiscoveryQueue(),
  ) {
    this.floatSyncUseCase = new SyncResaleItemFloatsUseCase(marketRepository);
  }

  async execute(): Promise<{
    synced: number;
    skipped: number;
    assetsFetched: number;
    rowsUsed: number;
    rateLimited: boolean;
    floatsIndexed: number;
  }> {
    if (!config.steamwebapiApiKey) {
      console.warn(
        "[Market Sync] STEAMWEBAPI_API_KEY no configurado. Sincronización omitida.",
      );
      return {
        synced: 0,
        skipped: 0,
        assetsFetched: 0,
        rowsUsed: 0,
        rateLimited: false,
        floatsIndexed: 0,
      };
    }

    console.log(
      `[Market Sync] Preparando cola YouPin priorizada por catálogo local Items API...`,
    );

    const queue = await this.priorityQueue.build();
    if (!queue.catalogAvailable || queue.candidates.length === 0) {
      console.warn(
        `[Market Sync] Sync omitido: ${queue.reason ?? "cola priorizada vacía"}`,
      );
      return {
        synced: 0,
        skipped: 0,
        assetsFetched: 0,
        rowsUsed: 0,
        rateLimited: false,
        floatsIndexed: 0,
      };
    }

    const rowsPerItem = Math.max(1, config.marketSync.priorityRowsPerItem);
    const rowBudget = Math.max(rowsPerItem, config.marketSync.priorityRowBudget);
    const maxCandidates = Math.min(
      queue.candidates.length,
      Math.max(1, Math.floor(rowBudget / rowsPerItem)),
    );

    const state = await this.syncStateRepository.get(MARKET_SYNC_STATE_KEY);
    let cursor =
      state?.queueVersion === queue.queueVersion
        ? clampCursor(state.cursorIndex, queue.candidates.length)
        : 0;

    await this.syncStateRepository.markStarted(
      MARKET_SYNC_STATE_KEY,
      queue.queueVersion,
      cursor,
    );

    console.log(
      `[Market Sync] Cola lista: ${queue.candidates.length} skins reales, cursor=${cursor}, budget=${rowBudget} filas, rowsPerItem=${rowsPerItem}, sort=${config.marketSync.sort}.`,
    );

    let skipped = 0;
    let assetsFetched = 0;
    let rowsUsed = 0;
    let rateLimited = false;
    let attemptedCandidates = 0;
    let lastError: string | null = null;
    const groups = new Map<string, CatalogGroup>();
    const emptyListingNames: string[] = [];

    try {
      for (let i = 0; i < maxCandidates; i++) {
        if (rowsUsed + rowsPerItem > rowBudget) break;

        const candidate = queue.candidates[cursor];
        if (!candidate) break;

        attemptedCandidates++;
        const progressMessageIndex = i + 1;
        // El frontend interpreta currentPage/maxPages como progreso; en este modo
        // representan candidatos consultados y no páginas generales de la API.
        marketSyncProgressService.updateFetchPage(
          progressMessageIndex,
          assetsFetched,
        );

        const result = await this.floatSyncUseCase.fetchFloats(
          "pending",
          candidate.marketHashName,
          {
            includeCsfloat: false,
            pageSize: rowsPerItem,
            maxPages: 1,
            maxPerItem: rowsPerItem,
            sort: config.marketSync.sort,
          },
        );

        rowsUsed += result.rowsUsed;
        assetsFetched += result.assetsFetched;

        if (result.rateLimited) {
          rateLimited = true;
          lastError = result.errors[0] ?? "Rate limited";
          break;
        }

        if (result.failed) {
          skipped++;
          lastError = result.errors.join("; ") || "float/assets error";
          cursor = advanceCursor(cursor, queue.candidates.length);
          continue;
        }

        const grouped = groupYoupinAssetsIntoCatalog(
          result.assets,
          config.marketSync.minPrice,
        );
        skipped += grouped.skipped;

        if (grouped.groups.size === 0) {
          emptyListingNames.push(candidate.marketHashName);
        } else {
          mergeCatalogGroups(groups, grouped.groups);
          if (!grouped.groups.has(candidate.marketHashName)) {
            emptyListingNames.push(candidate.marketHashName);
          }
        }

        cursor = advanceCursor(cursor, queue.candidates.length);
      }

      const listings = [...groups.values()].map((group) => group.listing);
      const floatsByName = new Map(
        [...groups.entries()].map(([name, group]) => [name, group.floats]),
      );
      const totalFloats = [...groups.values()].reduce(
        (count, group) => count + group.floats.length,
        0,
      );

      await this.marketRepository.syncCatalogSliceWithFloats(
        listings,
        floatsByName,
        emptyListingNames,
      );

      await this.syncStateRepository.markFinished(
        MARKET_SYNC_STATE_KEY,
        queue.queueVersion,
        {
          cursorIndex: cursor,
          lastRowsUsed: rowsUsed,
          lastCandidatesVisited: attemptedCandidates,
          lastError,
        },
      );

      console.log(
        `[Market Sync] ${attemptedCandidates} candidatos consultados desde JSON local; ${listings.length} listings, ${totalFloats} floats indexados (${skipped} omitidos, ${rowsUsed} filas${rateLimited ? ", RATE LIMITED" : ""}).`,
      );

      return {
        synced: listings.length,
        skipped,
        assetsFetched,
        rowsUsed,
        rateLimited,
        floatsIndexed: totalFloats,
      };
    } catch (error) {
      await this.syncStateRepository.markFinished(
        MARKET_SYNC_STATE_KEY,
        queue.queueVersion,
        {
          cursorIndex: cursor,
          lastRowsUsed: rowsUsed,
          lastCandidatesVisited: attemptedCandidates,
          lastError: error instanceof Error ? error.message : String(error),
        },
      );
      console.error("[Market Sync Error] Error al obtener float/assets:", error);
      throw error;
    }
  }
}
