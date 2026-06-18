import { IMarketRepository } from "../domain/IMarketRepository";
import { config } from "../../../shared/config";
import { SteamWebApiFloatAssetsClient } from "../infrastructure/SteamWebApiFloatAssetsClient";
import { groupYoupinAssetsIntoCatalog } from "./floatCatalogMapper";

/**
 * Sincroniza el catálogo YouPin desde GET /steam/api/float/assets.
 * Cada asset trae su precio concreto (USD); se persiste en FloatItem.price
 * y el listing padre deriva price/youpinAsk del mínimo de sus floats.
 * No se consulta /items ni otros endpoints de precios para reventa.
 */
export class SyncMarketListingsUseCase {
  private floatClient = new SteamWebApiFloatAssetsClient();

  constructor(private marketRepository: IMarketRepository) {}

  async execute(): Promise<{
    synced: number;
    skipped: number;
    assetsFetched: number;
    rowsUsed: number;
    rateLimited: boolean;
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
      };
    }

    console.log(
      `[Market Sync] Escaneando catálogo YouPin vía float/assets (limit=${config.marketSync.pageSize}, maxPages=${config.marketSync.maxPages})...`,
    );

    try {
      const { assets, rowsUsed, rateLimited } =
        await this.floatClient.fetchYoupinCatalogPages({
          pageSize: config.marketSync.pageSize,
          maxPages: config.marketSync.maxPages,
          // sort: "lowest_float", // desactivado: usa default API (newest)
          withItems: true,
        });

      console.log(
        `[Market Sync] ${assets.length} assets YouPin recibidos (${rowsUsed} filas API${rateLimited ? ", RATE LIMITED" : ""}).`,
      );

      if (assets.length === 0) {
        return {
          synced: 0,
          skipped: 0,
          assetsFetched: 0,
          rowsUsed,
          rateLimited,
        };
      }

      const { groups, skipped } = groupYoupinAssetsIntoCatalog(
        assets,
        config.marketSync.minPrice,
      );

      const listings = [...groups.values()].map((g) => g.listing);
      const floatsByName = new Map(
        [...groups.entries()].map(([name, g]) => [name, g.floats]),
      );

      if (listings.length === 0) {
        console.warn(
          "[Market Sync] Ningún asset YouPin pasó los filtros de precio/float.",
        );
        return {
          synced: 0,
          skipped,
          assetsFetched: assets.length,
          rowsUsed,
          rateLimited,
        };
      }

      await this.marketRepository.syncCatalogWithFloats(listings, floatsByName);

      console.log(
        `[Market Sync] ${listings.length} listings con floats sincronizados (${skipped} assets omitidos).`,
      );

      return {
        synced: listings.length,
        skipped,
        assetsFetched: assets.length,
        rowsUsed,
        rateLimited,
      };
    } catch (error) {
      console.error("[Market Sync Error] Error al obtener float/assets:", error);
      throw error;
    }
  }
}
