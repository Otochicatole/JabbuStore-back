import { promises as fs } from "fs";
import path from "path";
import { SteamWebApiItemsCatalogStore } from "../../pricing";
import type { SteamWebApiItemsCatalogRow } from "../../pricing/domain/types";

export const CATALOG_GLOBAL_JSON_PATH = path.join(
  process.cwd(),
  "steamwebapi-json-data",
  "catalog-global.json",
);

export interface CatalogGlobalItemRow extends SteamWebApiItemsCatalogRow {
  youpinAsk: number;
  youpinVolume: null;
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

const VALID_WEAPON_NAMES = [
  "AK-47", "M4A4", "M4A1-S", "AWP", "SSG 08", "SG 553", "AUG", "FAMAS", "Galil AR", "G3SG1", "SCAR-20",
  "Glock-18", "USP-S", "Desert Eagle", "P250", "Five-SeveN", "Tec-9", "CZ75-Auto", "Dual Berettas", "R8 Revolver", "P2000",
  "MP9", "MAC-10", "MP7", "MP5-SD", "UMP-45", "P90", "PP-Bizon",
  "Nova", "XM1014", "MAG-7", "Sawed-Off", "Negev", "M249"
];

const RIFLES = ["AK-47", "M4A4", "M4A1-S", "AWP", "SSG 08", "SG 553", "AUG", "FAMAS", "Galil AR", "G3SG1", "SCAR-20"];
const PISTOLS = ["Glock-18", "USP-S", "Desert Eagle", "P250", "Five-SeveN", "Tec-9", "CZ75-Auto", "Dual Berettas", "R8 Revolver", "P2000"];
const SMGS = ["MP9", "MAC-10", "MP7", "MP5-SD", "UMP-45", "P90", "PP-Bizon"];
const HEAVY = ["Nova", "XM1014", "MAG-7", "Sawed-Off", "Negev", "M249"];

export interface CatalogFilters {
  catalogFilterKnivesEnabled?: boolean;
  catalogFilterGlovesEnabled?: boolean;
  catalogFilterRiflesEnabled?: boolean;
  catalogFilterPistolsEnabled?: boolean;
  catalogFilterSMGsEnabled?: boolean;
  catalogFilterHeavyEnabled?: boolean;
  catalogFilterSouvenirEnabled?: boolean;
  catalogFilterStatTrakEnabled?: boolean;
  catalogMinPrice?: number;
}

type SkinCategory = "knife" | "glove" | "rifle" | "pistol" | "smg" | "heavy";

function getSkinCategory(marketHashName: string): SkinCategory | null {
  if (!marketHashName || typeof marketHashName !== "string") return null;
  let name = marketHashName.trim();

  if (name.startsWith("Souvenir ")) name = name.replace("Souvenir ", "");
  if (name.startsWith("★ StatTrak™ ")) name = "★ " + name.slice(15).trim();
  if (name.startsWith("StatTrak™ ")) name = name.slice(10).trim();
  else if (name.startsWith("StatTrak ")) name = name.slice(9).trim();

  if (name.startsWith("★")) {
    return name.toLowerCase().includes("glove") ? "glove" : "knife";
  }

  for (const rifle of RIFLES) {
    if (name.startsWith(`${rifle} |`)) return "rifle";
  }
  for (const pistol of PISTOLS) {
    if (name.startsWith(`${pistol} |`)) return "pistol";
  }
  for (const smg of SMGS) {
    if (name.startsWith(`${smg} |`)) return "smg";
  }
  for (const h of HEAVY) {
    if (name.startsWith(`${h} |`)) return "heavy";
  }

  return null;
}

function isCategoryAllowed(marketHashName: string, filters?: CatalogFilters): boolean {
  if (!filters) return true;

  const isSouvenir = marketHashName.startsWith("Souvenir ");
  const isStatTrak = marketHashName.includes("StatTrak™ ") || marketHashName.includes("StatTrak ");

  if (filters.catalogFilterSouvenirEnabled === false && isSouvenir) return false;
  if (filters.catalogFilterStatTrakEnabled === false && isStatTrak) return false;

  const category = getSkinCategory(marketHashName);
  if (!category) return false;

  switch (category) {
    case "knife": return filters.catalogFilterKnivesEnabled !== false;
    case "glove": return filters.catalogFilterGlovesEnabled !== false;
    case "rifle": return filters.catalogFilterRiflesEnabled !== false;
    case "pistol": return filters.catalogFilterPistolsEnabled !== false;
    case "smg": return filters.catalogFilterSMGsEnabled !== false;
    case "heavy": return filters.catalogFilterHeavyEnabled !== false;
  }
}

function isSkinOnly(marketHashName: string): boolean {
  if (!marketHashName || typeof marketHashName !== "string") return false;
  let name = marketHashName.trim();

  if (name.startsWith("★ StatTrak™ ")) name = "★ " + name.slice(15).trim();
  if (name.startsWith("StatTrak™ ")) name = name.slice(10).trim();
  else if (name.startsWith("StatTrak ")) name = name.slice(9).trim();
  
  if (name.startsWith("Souvenir ")) name = name.replace("Souvenir ", "");

  // Todos los cuchillos y guantes comienzan con ★
  if (name.startsWith("★")) return true;

  // Todas las skins de armas deben comenzar con "<NombreArma> |"
  for (const weapon of VALID_WEAPON_NAMES) {
    if (name.startsWith(`${weapon} |`)) {
      return true;
    }
  }

  return false;
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

    // 2. Filtrar items (solo skins, sin stickers, llaveros ni cajas)
    const matchedItems: CatalogGlobalItemRow[] = [];
    const index = new Set<string>(); // para evitar duplicados

    for (const catalogRow of catalogSnapshot.items) {
      const marketHashName = getCatalogMarketHashName(catalogRow);
      if (!marketHashName) continue;

      if (!isSkinOnly(marketHashName)) continue;

      if (filters && !isCategoryAllowed(marketHashName, filters)) continue;

      const variants = Array.isArray(catalogRow.variants) ? catalogRow.variants : [];

      if (variants.length > 0) {
        for (const variant of variants) {
          const variantPrice = variant.pricereal ?? catalogRow.pricesafe ?? catalogRow.pricereal ?? 0;
          if (variantPrice <= 0 || variantPrice < minPrice) continue;

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
        if (youpinAsk <= 0 || youpinAsk < minPrice) continue;

        index.add(dedupKey);

        matchedItems.push({
          ...catalogRow,
          markethashname: marketHashName,
          youpinAsk,
          youpinVolume: null,
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
    await fs.writeFile(this.catalogGlobalPath, JSON.stringify(payload, null, 2), "utf-8");

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
