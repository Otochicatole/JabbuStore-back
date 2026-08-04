import { promises as fs } from "fs";
import path from "path";
import { SteamWebApiMarketPricesClient } from "../../pricing/infrastructure/SteamWebApiMarketPricesClient";
import type { SteamWebApiYoupinPriceRow } from "../../pricing/domain/types";

export const YOUPIN_PRICES_JSON_PATH = path.join(
  process.cwd(),
  "steamwebapi-json-data",
  "youpin-prices.json",
);

export interface DownloadYoupinPricesResult {
  fetchedAt: string;
  itemCount: number;
  filePath: string;
  durationMs: number;
}

export interface YoupinPricesJsonPayload {
  fetchedAt: string;
  itemCount: number;
  items: SteamWebApiYoupinPriceRow[];
}

export class DownloadYoupinPricesUseCase {
  constructor(
    private readonly pricesClient = new SteamWebApiMarketPricesClient(),
    private readonly filePath = YOUPIN_PRICES_JSON_PATH,
  ) {}

  async execute(): Promise<DownloadYoupinPricesResult> {
    const start = Date.now();
    console.log("[DownloadYoupinPrices] Descargando /market/youpin/prices...");

    const pricesResult = await this.pricesClient.fetchBotPriceCatalogs(true);
    const youpinMap = pricesResult.bundle.youpin;

    if (!youpinMap || youpinMap.size === 0) {
      const errorMsg = pricesResult.errors.join("; ") || "No se recibieron precios de YouPin.";
      console.warn(`[DownloadYoupinPrices] Error: ${errorMsg}`);
      throw new Error(`YouPin Prices vacio o no disponible. ${errorMsg}`);
    }

    const items: SteamWebApiYoupinPriceRow[] = Array.from(youpinMap.values());
    const fetchedAt = new Date().toISOString();

    const payload: YoupinPricesJsonPayload = {
      fetchedAt,
      itemCount: items.length,
      items,
    };

    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");

    const durationMs = Date.now() - start;
    console.log(
      `[DownloadYoupinPrices] Guardado en ${this.filePath} con ${items.length} ítems en ${durationMs}ms.`,
    );

    return {
      fetchedAt,
      itemCount: items.length,
      filePath: this.filePath,
      durationMs,
    };
  }
}
