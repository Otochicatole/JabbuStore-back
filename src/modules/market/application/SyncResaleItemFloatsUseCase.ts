import { IMarketRepository } from "../domain/IMarketRepository";
import { FloatItem } from "../domain/FloatItem";
import { config } from "../../../shared/config";
import { PriceEnrichmentService } from "../../../shared/infrastructure/PriceEnrichmentService";
import {
  assetMatchesListingBase,
  extractWearCode,
  isSouvenirName,
  isStatTrakName,
  resolveDefIndexFromBaseName,
  resolvePaintIndexForPhase,
  toSteamWebApiPhaseParam,
} from "./floatSyncHelpers";
import {
  assetToFloatItem,
  resolveListingNameFromAsset,
} from "./floatCatalogMapper";
import { SteamWebApiFloatAssetsClient } from "../infrastructure/SteamWebApiFloatAssetsClient";

export interface SyncFloatsOptions {
  includeCsfloat?: boolean;
}

export interface FloatFetchResult {
  floats: FloatItem[];
  rowsUsed: number;
  rateLimited: boolean;
}

export class SyncResaleItemFloatsUseCase {
  private floatClient = new SteamWebApiFloatAssetsClient();

  constructor(private marketRepository: IMarketRepository) {}

  async execute(
    resaleItemId: string,
    marketHashName: string,
    options: SyncFloatsOptions = {},
  ): Promise<FloatItem[]> {
    const result = await this.fetchFloats(resaleItemId, marketHashName, options);
    await this.marketRepository.saveFloats(resaleItemId, result.floats);
    console.log(
      `[Sync Resale Floats] "${marketHashName}": ${result.floats.length} floats guardados (${result.rowsUsed} filas${result.rateLimited ? ", RATE LIMITED" : ""}).`,
    );
    return result.floats;
  }

  async fetchFloats(
    resaleItemId: string,
    marketHashName: string,
    options: SyncFloatsOptions = {},
  ): Promise<FloatFetchResult> {
    if (!config.steamwebapiApiKey) {
      console.warn("[Sync Resale Floats] STEAMWEBAPI_API_KEY no configurado. Omitiendo.");
      return { floats: [], rowsUsed: 0, rateLimited: false };
    }

    const { baseName, phase } = PriceEnrichmentService.getBaseNameAndPhase(marketHashName);
    const queryName = baseName || marketHashName;
    const { pageSize, maxPages, maxPerItem } = config.floatSync;

    let rowsUsed = 0;
    let rateLimited = false;
    let matchedAssets: any[] = [];

    const collectFromPages = async (
      source: "youpin" | "csfloat",
      buildQuery: (pageLimit: number, page: number) => Parameters<SteamWebApiFloatAssetsClient["fetchPage"]>[0],
    ): Promise<any[]> => {
      const pageLimit = Math.min(maxPerItem, pageSize);
      const matched: any[] = [];

      for (let page = 0; page < maxPages; page++) {
        const result = await this.floatClient.fetchPage(
          buildQuery(pageLimit, page),
        );
        rowsUsed += result.rowsUsed;
        if (result.rateLimited) {
          rateLimited = true;
          break;
        }
        if (result.assets.length === 0) break;

        for (const asset of result.assets) {
          if (this.assetMatches(asset, queryName, phase, marketHashName)) {
            matched.push(asset);
          }
        }

        if (matched.length >= maxPerItem) break;
        if ((page + 1) * pageLimit >= result.total) break;
      }

      return matched;
    };

    const fetchPhasedDoppler = async (source: "youpin" | "csfloat"): Promise<any[]> => {
      if (!phase) return [];

      const paintIndex = resolvePaintIndexForPhase(phase, queryName);
      if (paintIndex == null) return [];

      const wear = extractWearCode(queryName) ?? extractWearCode(marketHashName);
      const defIndex = resolveDefIndexFromBaseName(queryName);
      const phaseParam = toSteamWebApiPhaseParam(phase);

      const runQuery = (useDefIndex: boolean) =>
        collectFromPages(source, (pageLimit, page) => {
          const query: Parameters<SteamWebApiFloatAssetsClient["fetchPage"]>[0] = {
            source,
            onlyMarketId: true,
            withItems: true,
            limit: pageLimit,
            offset: page * pageLimit,
            sort: "lowest_float",
            paintIndex,
          };
          if (wear) query.wear = wear;
          if (isStatTrakName(queryName)) query.isStatTrak = true;
          if (isSouvenirName(queryName)) query.isSouvenir = true;
          if (useDefIndex && defIndex != null) query.defIndex = defIndex;
          if (phaseParam) query.phase = phaseParam;
          return query;
        });

      let matched = await runQuery(true);
      if (matched.length === 0 && defIndex != null) {
        matched = await runQuery(false);
      }

      if (matched.length > 0) {
        console.log(
          `[Sync Resale Floats] ${source}: ${matched.length} floats (paint_index=${paintIndex}) para "${queryName}".`,
        );
      }
      return matched;
    };

    const fetchByMarketHashName = async (source: "youpin" | "csfloat"): Promise<any[]> => {
      const matched = await collectFromPages(source, (pageLimit, page) => ({
        source,
        onlyMarketId: true,
        withItems: true,
        limit: pageLimit,
        offset: page * pageLimit,
        sort: "lowest_float",
        marketHashName: queryName,
      }));

      if (matched.length > 0) {
        console.log(
          `[Sync Resale Floats] ${source}: ${matched.length} floats para "${queryName}".`,
        );
      }
      return matched;
    };

    const fetchSource = async (source: "youpin" | "csfloat") =>
      phase ? fetchPhasedDoppler(source) : fetchByMarketHashName(source);

    matchedAssets = await fetchSource("youpin");

    if (matchedAssets.length === 0 && options.includeCsfloat) {
      matchedAssets = await fetchSource("csfloat");
      if (matchedAssets.length > 0) {
        console.log(
          `[Sync Resale Floats] CSFloat usado como respaldo para "${marketHashName}".`,
        );
      }
    }

    const floats = matchedAssets
      .map((asset) => assetToFloatItem(asset, resaleItemId))
      .filter((f): f is FloatItem => f != null)
      .sort((a, b) => a.price - b.price)
      .slice(0, maxPerItem);

    return { floats, rowsUsed, rateLimited };
  }

  private assetMatches(
    asset: any,
    baseName: string,
    phase: string | null,
    expectedListingName: string,
  ): boolean {
    if (asset?.source !== "youpin" && asset?.source !== "csfloat") return false;

    const listingName = resolveListingNameFromAsset(asset);
    if (
      listingName !== expectedListingName &&
      !assetMatchesListingBase(
        asset.markethashname ?? asset.market_hash_name ?? "",
        baseName,
      )
    ) {
      return false;
    }

    if (phase) {
      const expectedPaint = resolvePaintIndexForPhase(phase, baseName);
      if (expectedPaint != null) {
        const assetPaint = Number(asset.paintindex ?? asset.paint_index);
        if (assetPaint && assetPaint !== expectedPaint) return false;
      }
    }

    if (isStatTrakName(baseName) && Number(asset.isstattrak) !== 1) return false;
    if (isSouvenirName(baseName) && Number(asset.issouvenir) !== 1) return false;

    return assetToFloatItem(asset, "check") != null;
  }
}
