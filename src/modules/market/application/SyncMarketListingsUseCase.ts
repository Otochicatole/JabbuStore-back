import { IMarketRepository } from "../domain/IMarketRepository";
import { MarketListingUpsert } from "../domain/MarketListing";
import { PriceEnrichmentService } from "../../../shared/infrastructure/PriceEnrichmentService";
import { config } from "../../../shared/config";

/**
 * Sincroniza el catálogo de market listings (Buff163 + YouPin) desde la API de cs2.sh.
 * Guarda el proveedor real, ambos precios (ask de youpin y buff) y detecta cuál tiene
 * mejor liquidez para usarlo como precio base.
 */
export class SyncMarketListingsUseCase {
  constructor(private marketRepository: IMarketRepository) {}

  async execute(): Promise<{ synced: number; skipped: number }> {
    const apiKey = config.steamwebapiApiKey;
    if (!apiKey) {
      console.warn(
        "[Market Sync] STEAMWEBAPI_API_KEY no configurado. Sincronización omitida.",
      );
      return { synced: 0, skipped: 0 };
    }

    console.log(
      "[Market Sync] Obteniendo catálogo completo de ítems desde SteamWebAPI...",
    );

    try {
      const res = await fetch(
        `https://www.steamwebapi.com/steam/api/items?key=${apiKey}&appid=730`,
      );

      if (!res.ok) {
        throw new Error(`SteamWebAPI respondió con error ${res.status}`);
      }

      const items = (await res.json()) as any[];
      console.log(
        `[Market Sync] Descargados ${items.length} ítems. Procesando listings...`,
      );

      // Obtener imágenes de ByMykel para enriquecer los listings que falten
      const imagesMap = await PriceEnrichmentService.fetchByMykelSkinsImages();

      const listings: MarketListingUpsert[] = [];
      let skipped = 0;

      for (const item of items) {
        if (!item || !item.markethashname) continue;

        const name = item.markethashname;

        // Extraer precios
        const prices = item.prices || [];
        const youpinObj = prices.find((p: any) => p.source === "youpin");
        const buffObj = prices.find((p: any) => p.source === "buff");

        const youpinAsk = youpinObj ? Number(youpinObj.price) : null;
        const youpinVolume = youpinObj ? Number(youpinObj.quantity) : null;
        const buffAsk = buffObj ? Number(buffObj.price) : null;
        const buffVolume = buffObj ? Number(buffObj.quantity) : null;

        const totalVolume = (youpinVolume ?? 0) + (buffVolume ?? 0);

        // Filtrar base por liquidez mínima (al menos 2 ofertas activas en total)
        let hasBaseListing = totalVolume >= 2;
        let price = 0;
        let provider: "buff" | "youpin" = "youpin";

        if (hasBaseListing) {
          if (
            youpinAsk &&
            youpinVolume &&
            (!buffAsk || youpinVolume >= (buffVolume ?? 0))
          ) {
            provider = "youpin";
            price = youpinAsk;
          } else if (buffAsk) {
            provider = "buff";
            price = buffAsk;
          } else {
            hasBaseListing = false;
          }
        }

        // Registrar base listing si califica
        if (hasBaseListing && price > 0.5) {
          const details =
            PriceEnrichmentService.inferDetailsFromMarketHashName(name);
          const cleanBaseName =
            PriceEnrichmentService.cleanNameForImageLookup(name);
          const iconUrl =
            item.itemimage ||
            imagesMap.get(name) ||
            imagesMap.get(cleanBaseName) ||
            imagesMap.get("★ " + cleanBaseName) ||
            imagesMap.get(cleanBaseName.replace("★ ", "")) ||
            null;

          listings.push({
            name,
            provider,
            youpinAsk,
            youpinVolume,
            buffAsk,
            buffVolume,
            price,
            iconUrl,
            rarity: details.rarity,
            exterior: details.exterior,
            category: details.category,
            isStatTrak: details.isStatTrak,
            isSouvenir: details.isSouvenir,
          });
        } else {
          skipped++;
        }

        // Expandir variantes Doppler si existen
        if (item.variants && Array.isArray(item.variants)) {
          for (const variant of item.variants) {
            if (!variant.phase || !variant.pricereal) continue;

            const variantName = `${name} | ${variant.phase}`;
            const variantPrice = Number(variant.pricereal);

            if (variantPrice > 0.5) {
              const details =
                PriceEnrichmentService.inferDetailsFromMarketHashName(
                  variantName,
                );
              const cleanBaseVariantName =
                PriceEnrichmentService.cleanNameForImageLookup(variantName);
              const iconUrl =
                variant.image ||
                item.itemimage ||
                imagesMap.get(variantName) ||
                imagesMap.get(cleanBaseVariantName) ||
                imagesMap.get("★ " + cleanBaseVariantName) ||
                imagesMap.get(cleanBaseVariantName.replace("★ ", "")) ||
                null;

              listings.push({
                name: variantName,
                provider: "youpin", // fallback por defecto para variantes
                youpinAsk: variantPrice,
                youpinVolume: 10,
                buffAsk: variantPrice,
                buffVolume: 10,
                price: variantPrice,
                iconUrl,
                rarity: details.rarity,
                exterior: details.exterior,
                category: details.category,
                isStatTrak: details.isStatTrak,
                isSouvenir: details.isSouvenir,
              });
            }
          }
        }
      }

      if (listings.length === 0) {
        console.warn(
          "[Market Sync] No se obtuvieron listings con liquidez suficiente.",
        );
        return { synced: 0, skipped };
      }

      await this.marketRepository.replaceAll(listings);
      console.log(
        `[Market Sync] Sincronizados ${listings.length} listings (${skipped} omitidos por baja liquidez).`,
      );

      return { synced: listings.length, skipped };
    } catch (error) {
      console.error(
        "[Market Sync Error] Error al obtener datos de SteamWebAPI:",
        error,
      );
      throw error;
    }
  }
}
