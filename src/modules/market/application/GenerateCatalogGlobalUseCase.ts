import { promises as fs } from "fs";
import path from "path";
import { SteamWebApiItemsCatalogStore } from "../../pricing";
import type { SteamWebApiItemsCatalogRow } from "../../pricing/domain/types";
import {
  classifyCatalogItem,
  type CatalogItemType,
} from "../../catalog/domain/CatalogItemCapabilities";

export const CATALOG_GLOBAL_JSON_PATH = path.join(
  process.cwd(),
  "steamwebapi-json-data",
  "catalog-global.json",
);

export interface CatalogGlobalItemRow extends SteamWebApiItemsCatalogRow {
  youpinAsk: number;
  youpinVolume: null;
  catalogItemType: CatalogItemType;
  supportsFloatStock: boolean;
  priceFilterEligible: boolean;
  variantPhase?: string;
  variantPaintIndex?: number;
  variantImage?: string;
}

export interface CatalogGlobalPayload {
  generatedAt: string;
  totalCatalogItems: number;
  matchedItemsCount: number;
  items: CatalogGlobalItemRow[];
}

export interface GenerateCatalogGlobalResult {
  generatedAt: string;
  totalCatalogItems: number;
  matchedItemsCount: number;
  filePath: string;
  durationMs: number;
}

export interface CatalogFilters {
  catalogFilterKnivesEnabled?: boolean;
  catalogFilterGlovesEnabled?: boolean;
  catalogFilterRiflesEnabled?: boolean;
  catalogFilterPistolsEnabled?: boolean;
  catalogFilterSMGsEnabled?: boolean;
  catalogFilterHeavyEnabled?: boolean;
  catalogFilterEquipmentEnabled?: boolean;
  catalogFilterStickersEnabled?: boolean;
  catalogFilterContainersEnabled?: boolean;
  catalogFilterAgentsEnabled?: boolean;
  catalogFilterCharmsEnabled?: boolean;
  catalogFilterGraffitiEnabled?: boolean;
  catalogFilterPatchesEnabled?: boolean;
  catalogFilterMusicKitsEnabled?: boolean;
  catalogFilterCollectiblesEnabled?: boolean;
  catalogFilterPassesEnabled?: boolean;
  catalogFilterKeysEnabled?: boolean;
  catalogFilterGiftsEnabled?: boolean;
  catalogFilterToolsEnabled?: boolean;
  catalogFilterTagsEnabled?: boolean;
  catalogFilterSouvenirEnabled?: boolean;
  catalogFilterStatTrakEnabled?: boolean;
  catalogMinPrice?: number;
}

export type CatalogFilterSettingsSource = CatalogFilters;

export function catalogFiltersFromSettings(
  settings: CatalogFilterSettingsSource,
): CatalogFilters {
  return { ...settings };
}

const FILTER_BY_ITEM_TYPE: Partial<Record<CatalogItemType, keyof CatalogFilters>> = {
  knife: "catalogFilterKnivesEnabled",
  gloves: "catalogFilterGlovesEnabled",
  rifle: "catalogFilterRiflesEnabled",
  sniper_rifle: "catalogFilterRiflesEnabled",
  pistol: "catalogFilterPistolsEnabled",
  smg: "catalogFilterSMGsEnabled",
  shotgun: "catalogFilterHeavyEnabled",
  machinegun: "catalogFilterHeavyEnabled",
  equipment: "catalogFilterEquipmentEnabled",
  sticker: "catalogFilterStickersEnabled",
  container: "catalogFilterContainersEnabled",
  agent: "catalogFilterAgentsEnabled",
  charm: "catalogFilterCharmsEnabled",
  graffiti: "catalogFilterGraffitiEnabled",
  patch: "catalogFilterPatchesEnabled",
  music_kit: "catalogFilterMusicKitsEnabled",
  collectible: "catalogFilterCollectiblesEnabled",
  pass: "catalogFilterPassesEnabled",
  key: "catalogFilterKeysEnabled",
  gift: "catalogFilterGiftsEnabled",
  tool: "catalogFilterToolsEnabled",
  tag: "catalogFilterTagsEnabled",
};

function isCategoryAllowed(
  catalogRow: SteamWebApiItemsCatalogRow,
  marketHashName: string,
  filters?: CatalogFilters,
): boolean {
  const capabilities = classifyCatalogItem({
    itemgroup: catalogRow.itemgroup,
    itemtype: catalogRow.itemtype,
    name: marketHashName,
  });
  const filterKey = FILTER_BY_ITEM_TYPE[capabilities.itemType];
  if (!filterKey) return false;
  if (!filters) return true;

  const isSouvenir = marketHashName.startsWith("Souvenir ");
  const isStatTrak = marketHashName.includes("StatTrak™ ") || marketHashName.includes("StatTrak ");

  if (filters.catalogFilterSouvenirEnabled === false && isSouvenir) return false;
  if (filters.catalogFilterStatTrakEnabled === false && isStatTrak) return false;

  return filterKey ? filters[filterKey] !== false : false;
}

function getCatalogMarketHashName(row: SteamWebApiItemsCatalogRow): string | null {
  const name =
    row.markethashname ??
    row.market_hash_name ??
    row.marketname ??
    row.normalizedname;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

export class GenerateCatalogGlobalUseCase {
  constructor(
    private readonly catalogStore = new SteamWebApiItemsCatalogStore(),
    private readonly catalogGlobalPath = CATALOG_GLOBAL_JSON_PATH,
  ) {}

  async execute(filters?: CatalogFilters): Promise<GenerateCatalogGlobalResult> {
    const start = Date.now();
    const minPrice = filters?.catalogMinPrice ?? 0;
    console.log("[GenerateCatalogGlobal] Leyendo items-catalog.json...", filters ? "con filtros" : "sin filtros");

    // 1. Leer items-catalog.json
    const catalogSnapshot = await this.catalogStore.readCatalog();
    if (!catalogSnapshot || !Array.isArray(catalogSnapshot.items) || catalogSnapshot.items.length === 0) {
      throw new Error("items-catalog.json no esta disponible o esta vacio. Ejecuta el Paso 1 primero.");
    }

    // 2. Filtrar por tipo canónico y por los switches administrativos.
    const matchedItems: CatalogGlobalItemRow[] = [];
    const index = new Set<string>(); // para evitar duplicados

    for (const catalogRow of catalogSnapshot.items) {
      const marketHashName = getCatalogMarketHashName(catalogRow);
      if (!marketHashName) continue;

      if (!isCategoryAllowed(catalogRow, marketHashName, filters)) continue;

      const capabilities = classifyCatalogItem({
        itemgroup: catalogRow.itemgroup,
        itemtype: catalogRow.itemtype,
        name: marketHashName,
      });

      const variants = Array.isArray(catalogRow.variants) ? catalogRow.variants : [];

      if (capabilities.supportsFloatStock && variants.length > 0) {
        for (const variant of variants) {
          const variantPrice = variant.pricereal ?? catalogRow.pricesafe ?? catalogRow.pricereal ?? 0;
          if (
            variantPrice <= 0 ||
            (capabilities.priceFilterEligible && variantPrice < minPrice)
          ) continue;

          const variantPaintIndex = variant.paintindex ?? variant.paint_index;
          const dedupKey = variantPaintIndex != null
            ? `${marketHashName}::${variantPaintIndex}`
            : `${marketHashName}::variant-${variant.phase ?? 'unknown'}`;

          if (index.has(dedupKey)) continue;
          index.add(dedupKey);

          const row: CatalogGlobalItemRow = {
            ...catalogRow,
            markethashname: marketHashName,
            youpinAsk: variantPrice,
            youpinVolume: null as null,
            catalogItemType: capabilities.itemType,
            supportsFloatStock: capabilities.supportsFloatStock,
            priceFilterEligible: capabilities.priceFilterEligible,
          };
          if (variant.phase) (row as any).variantPhase = variant.phase;
          if (variantPaintIndex != null) (row as any).variantPaintIndex = variantPaintIndex;
          if (variant.image) (row as any).variantImage = variant.image;

          matchedItems.push(row);
        }
      } else {
        const paintIndex = catalogRow.paintindex;
        const dedupKey = paintIndex != null ? `${marketHashName}::${paintIndex}` : marketHashName;

        if (index.has(dedupKey)) continue;

        const youpinAsk = catalogRow.pricesafe ?? catalogRow.pricereal ?? 0;
        if (
          youpinAsk <= 0 ||
          (capabilities.priceFilterEligible && youpinAsk < minPrice)
        ) continue;

        index.add(dedupKey);

        matchedItems.push({
          ...catalogRow,
          markethashname: marketHashName,
          youpinAsk,
          youpinVolume: null,
          catalogItemType: capabilities.itemType,
          supportsFloatStock: capabilities.supportsFloatStock,
          priceFilterEligible: capabilities.priceFilterEligible,
        });
      }
    }

    const generatedAt = new Date().toISOString();
    const payload: CatalogGlobalPayload = {
      generatedAt,
      totalCatalogItems: catalogSnapshot.items.length,
      matchedItemsCount: matchedItems.length,
      items: matchedItems,
    };

    const dir = path.dirname(this.catalogGlobalPath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = `${this.catalogGlobalPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf-8");
    await fs.rename(tempPath, this.catalogGlobalPath);

    const durationMs = Date.now() - start;
    console.log(
      `[GenerateCatalogGlobal] Generado ${this.catalogGlobalPath} con ${matchedItems.length} items en ${durationMs}ms.`,
    );

    return {
      generatedAt,
      totalCatalogItems: catalogSnapshot.items.length,
      matchedItemsCount: matchedItems.length,
      filePath: this.catalogGlobalPath,
      durationMs,
    };
  }
}
