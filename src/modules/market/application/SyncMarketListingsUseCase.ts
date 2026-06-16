import { IMarketRepository } from "../domain/IMarketRepository";
import { MarketListingUpsert } from "../domain/MarketListing";
import { PriceEnrichmentService } from "../../../shared/infrastructure/PriceEnrichmentService";
import { config } from "../../../shared/config";

/**
 * Sincroniza el catálogo de market listings (YouPin) desde la API de cs2.sh.
 * Guarda YouPin como proveedor de datos y su precio ask para usarlo como precio base.
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

        // Extraer precios de SteamWebAPI (ya vienen convertidos a USD por el proveedor)
        const prices = item.prices || [];
        const youpinObj = prices.find((p: any) => p.source === "youpin");

        const youpinAsk = youpinObj ? Number(youpinObj.price) : null;
        const youpinVolumeRaw = youpinObj ? Number(youpinObj.quantity) : null;

        // Si Youpin no trae stock individual de forma directa, usamos realmarketsquantity u offervolume de SteamWebAPI
        const apiTotalQuantity =
          Number(item.realmarketsquantity) || Number(item.offervolume) || 0;

        const youpinVolume =
          youpinVolumeRaw ??
          (apiTotalQuantity > 0
            ? Math.max(1, Math.round(apiTotalQuantity * 0.45))
            : null);

        // Sumar liquidez de TODOS los mercados disponibles para tener datos estables
        const totalVolume =
          prices.reduce(
            (sum: number, p: any) => sum + (Number(p.quantity) || 0),
            0,
          ) || apiTotalQuantity;

        // Filtrar base por liquidez mínima (al menos 2 ofertas activas en total)
        let hasBaseListing = totalVolume >= 2;
        let price = 0;
        let provider: "youpin" = "youpin";

        if (hasBaseListing) {
          if (youpinAsk && youpinVolume) {
            provider = "youpin";
            price = youpinAsk;
          } else {
            // FALLBACK DE SEGURIDAD: Si Youpin no está disponible de forma directa en el catálogo del proveedor,
            // usar el precio más bajo disponible entre los otros mercados (CSFloat, Skinport, DMarket, etc.)
            const availablePrices = prices
              .map((p: any) => Number(p.price))
              .filter((p: number) => p > 0);
            if (availablePrices.length > 0) {
              price = Math.min(...availablePrices);
              provider = "youpin";
            } else {
              hasBaseListing = false;
            }
          }
        }

        // Registrar base listing si califica
        if (hasBaseListing && price > 0.5) {
          // CAP DE SEGURIDAD CONTRA PRECIOS MANIPULADOS O ERRÓNEOS:
          // El precio de reventa de Youpin nunca debe ser superior al precio oficial del Mercado de Steam,
          // pero únicamente aplicamos este límite a ítems de bajo/medio rango (Steam Price < $150)
          // para no recortar ítems de alto rango (como Dragon Lore, Gungnir, Howl, etc.) que superan el límite de cartera de Steam ($2000).
          const steamPrice =
            Number(item.pricemedian) ||
            Number(item.priceavg) ||
            Number(item.pricelatestsell) ||
            null;
          if (steamPrice && steamPrice < 150 && price > steamPrice) {
            price = Math.round(steamPrice * 0.8 * 100) / 100; // Cap a un 80% del valor de Steam
          }

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
              let finalVariantPrice = variantPrice;

              // Corregir precios de variantes Doppler de alto tier si vienen con error desde la API (p. ej. Black Pearl, Ruby, Sapphire, Emerald)
              const isRuby = variant.phase === "Ruby";
              const isSapphire = variant.phase === "Sapphire";
              const isBlackPearl = variant.phase === "Black Pearl";
              const isEmerald = variant.phase === "Emerald";

              if (isRuby || isSapphire || isBlackPearl || isEmerald) {
                let multiplier = 1.0;
                if (isBlackPearl) multiplier = 8.0;
                else if (isRuby) multiplier = 9.0;
                else if (isSapphire) multiplier = 10.0;
                else if (isEmerald) multiplier = 12.0;

                const minPrice = price * multiplier;
                if (finalVariantPrice < minPrice) {
                  console.log(`[Doppler Variant Correction] Correcting price for "${variantName}" from $${finalVariantPrice} to $${minPrice} (Base: $${price}, Multiplier: ${multiplier}x)`);
                  finalVariantPrice = minPrice;
                }
              }

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
                provider: "youpin",
                youpinAsk: finalVariantPrice,
                youpinVolume: 10,
                price: finalVariantPrice,
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
