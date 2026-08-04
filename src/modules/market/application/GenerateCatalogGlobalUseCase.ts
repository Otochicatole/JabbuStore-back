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

function isSkinOnly(marketHashName: string): boolean {
  if (!marketHashName || typeof marketHashName !== "string") return false;
  let name = marketHashName.trim();

  if (name.startsWith("StatTrak™ ")) name = name.slice(10).trim();
  else if (name.startsWith("StatTrak ")) name = name.slice(9).trim();
  
  if (name.startsWith("Souvenir ")) return false;

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

  async execute(): Promise<GenerateCatalogGlobalResult> {
    const start = Date.now();
    console.log("[GenerateCatalogGlobal] Leyendo items-catalog.json...");

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
      
      if (index.has(marketHashName)) continue;

      if (!isSkinOnly(marketHashName)) continue;

      // Usamos el precio del catálogo. pricesafe o pricereal.
      const youpinAsk = catalogRow.pricesafe ?? catalogRow.pricereal ?? 0;
      if (youpinAsk <= 0) continue;

      index.add(marketHashName);

      matchedItems.push({
        ...catalogRow,
        markethashname: marketHashName,
        youpinAsk,
        youpinVolume: null,
      });
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
