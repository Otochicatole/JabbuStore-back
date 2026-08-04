import { promises as fs } from "fs";
import path from "path";
import { SteamWebApiItemsCatalogStore } from "../../pricing";
import type { SteamWebApiItemsCatalogRow, SteamWebApiYoupinPriceRow } from "../../pricing/domain/types";
import { buildCatalogIndex, buildYoupinPricesIndex } from "./YoupinCatalogMatcher";
import type { YoupinPricesJsonPayload } from "./DownloadYoupinPricesUseCase";

export const CATALOG_GLOBAL_JSON_PATH = path.join(
  process.cwd(),
  "steamwebapi-json-data",
  "catalog-global.json",
);

export interface CatalogGlobalItemRow extends SteamWebApiItemsCatalogRow {
  youpinAsk: number;
  youpinVolume: number | null;
}

export interface CatalogGlobalPayload {
  generatedAt: string;
  totalCatalogItems: number;
  totalPriceRows: number;
  matchedItemsCount: number;
  items: CatalogGlobalItemRow[];
}

export interface GenerateCatalogGlobalResult {
  generatedAt: string;
  totalCatalogItems: number;
  totalPriceRows: number;
  matchedItemsCount: number;
  filePath: string;
  durationMs: number;
}

export class GenerateCatalogGlobalUseCase {
  constructor(
    private readonly catalogStore = new SteamWebApiItemsCatalogStore(),
    private readonly youpinPricesPath = path.join(
      process.cwd(),
      "steamwebapi-json-data",
      "youpin-prices.json",
    ),
    private readonly catalogGlobalPath = CATALOG_GLOBAL_JSON_PATH,
  ) {}

  async execute(): Promise<GenerateCatalogGlobalResult> {
    const start = Date.now();
    console.log("[GenerateCatalogGlobal] Leyendo items-catalog.json y youpin-prices.json...");

    // 1. Leer items-catalog.json
    const catalogSnapshot = await this.catalogStore.readCatalog();
    if (!catalogSnapshot || !Array.isArray(catalogSnapshot.items) || catalogSnapshot.items.length === 0) {
      throw new Error("items-catalog.json no esta disponible o esta vacio. Ejecuta el Paso 1 primero.");
    }

    // 2. Leer youpin-prices.json
    let youpinPricesPayload: YoupinPricesJsonPayload;
    try {
      const raw = await fs.readFile(this.youpinPricesPath, "utf-8");
      youpinPricesPayload = JSON.parse(raw);
    } catch (err) {
      throw new Error("youpin-prices.json no esta disponible. Ejecuta el Paso 2 primero.");
    }

    if (!Array.isArray(youpinPricesPayload.items) || youpinPricesPayload.items.length === 0) {
      throw new Error("youpin-prices.json no contiene items validos.");
    }

    // 3. Construir índices
    const catalogIndex = buildCatalogIndex(catalogSnapshot.items);
    const pricesIndex = buildYoupinPricesIndex(youpinPricesPayload.items);

    // 4. Cruzar y filtrar items
    const matchedItems: CatalogGlobalItemRow[] = [];

    for (const [marketHashName, priceRow] of pricesIndex.entries()) {
      const youpinAsk = typeof priceRow.price === "number" ? priceRow.price : 0;
      if (youpinAsk <= 0) continue;

      const catalogRow = catalogIndex.get(marketHashName);
      if (!catalogRow) continue;

      matchedItems.push({
        ...catalogRow,
        markethashname: marketHashName,
        youpinAsk,
        youpinVolume: typeof priceRow.quantity === "number" ? priceRow.quantity : null,
      });
    }

    const generatedAt = new Date().toISOString();
    const payload: CatalogGlobalPayload = {
      generatedAt,
      totalCatalogItems: catalogIndex.size,
      totalPriceRows: pricesIndex.size,
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
      totalCatalogItems: catalogIndex.size,
      totalPriceRows: pricesIndex.size,
      matchedItemsCount: matchedItems.length,
      filePath: this.catalogGlobalPath,
      durationMs,
    };
  }
}
