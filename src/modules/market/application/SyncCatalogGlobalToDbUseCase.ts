import { promises as fs } from "fs";
import path from "path";
import type { IMarketRepository } from "../domain/IMarketRepository";
import type { MarketListingUpsert } from "../domain/MarketListing";
import { MarketPricingService } from "./MarketPricingService";
import { PriceEnrichmentService } from "../../../shared/infrastructure/PriceEnrichmentService";
import type { CatalogGlobalPayload, CatalogGlobalItemRow } from "./GenerateCatalogGlobalUseCase";
import { CATALOG_GLOBAL_JSON_PATH } from "./GenerateCatalogGlobalUseCase";
import { prisma } from "../../../shared/infrastructure/PrismaClient";

export interface SyncCatalogGlobalToDbResult {
  syncedAt: string;
  totalListingsUpserted: number;
  durationMs: number;
}

function getCatalogIconUrl(row: CatalogGlobalItemRow): string | null {
  const image = row.image || row.itemimage;
  if (!image) return null;
  if (typeof image === "string" && /^https?:\/\//i.test(image)) return image;
  if (typeof image === "string" && image.length > 0) {
    return `https://community.cloudflare.steamstatic.com/economy/image/${image}/360fx360f`;
  }
  return null;
}

export class SyncCatalogGlobalToDbUseCase {
  constructor(
    private readonly marketRepository: IMarketRepository,
    private readonly catalogGlobalPath = CATALOG_GLOBAL_JSON_PATH,
  ) {}

  async execute(): Promise<SyncCatalogGlobalToDbResult> {
    const start = Date.now();
    console.log("[SyncCatalogGlobalToDb] Leyendo catalog-global.json para sincronizar a BD...");

    let payload: CatalogGlobalPayload;
    try {
      const raw = await fs.readFile(this.catalogGlobalPath, "utf-8");
      payload = JSON.parse(raw);
    } catch (err) {
      throw new Error("catalog-global.json no existe o esta dañado. Ejecuta el Paso 3 primero.");
    }

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new Error("catalog-global.json no contiene ítems válidos para sincronizar.");
    }

    const dbSettings = await prisma.adminSettings.findFirst();
    const settings = dbSettings
      ? {
          marketModifierEnabled: dbSettings.marketModifierEnabled,
          marketModifierType: dbSettings.marketModifierType,
          marketModifierValue: dbSettings.marketModifierValue,
        }
      : MarketPricingService.defaultSettings();
    const listings: MarketListingUpsert[] = [];

    for (const item of payload.items) {
      const marketHashName = item.markethashname ?? item.market_hash_name ?? item.marketname;
      if (!marketHashName || typeof marketHashName !== "string") continue;

      const youpinAsk = item.youpinAsk;
      if (!youpinAsk || youpinAsk <= 0) continue;

      const details = PriceEnrichmentService.inferDetailsFromMarketHashName(marketHashName);
      const iconUrl = getCatalogIconUrl(item);
      const price = MarketPricingService.computeListingPrice(youpinAsk, settings);

      listings.push({
        name: marketHashName,
        provider: "youpin",
        youpinAsk,
        youpinVolume: item.youpinVolume,
        price,
        iconUrl,
        rarity: details.rarity,
        exterior: details.exterior,
        category: details.category,
        isStatTrak: details.isStatTrak,
        isSouvenir: details.isSouvenir,
      });
    }

    console.log(`[SyncCatalogGlobalToDb] Upserteando ${listings.length} listings en base de datos...`);
    await this.marketRepository.upsertListings(listings);

    // Desactivar o marcar sin precio de YouPin las listings que ya no aparecen en catalog-global.json
    const activeNameSet = new Set(listings.map((l) => l.name));
    const existingActiveListings = await prisma.marketListing.findMany({
      where: { isPriceManual: false, youpinAsk: { not: null } },
      select: { id: true, name: true },
    });
    const toDeactivateIds = existingActiveListings
      .filter((item) => !activeNameSet.has(item.name))
      .map((item) => item.id);

    if (toDeactivateIds.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < toDeactivateIds.length; i += chunkSize) {
        const chunk = toDeactivateIds.slice(i, i + chunkSize);
        await prisma.marketListing.updateMany({
          where: { id: { in: chunk } },
          data: {
            youpinAsk: null,
          },
        });
      }
    }

    const durationMs = Date.now() - start;
    const syncedAt = new Date().toISOString();
    console.log(
      `[SyncCatalogGlobalToDb] Sincronización a BD completada: ${listings.length} listings actualizadas en ${durationMs}ms.`,
    );

    return {
      syncedAt,
      totalListingsUpserted: listings.length,
      durationMs,
    };
  }
}
