import { IMarketRepository } from '../domain/IMarketRepository';
import { MarketListingUpsert } from '../domain/MarketListing';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';
import { config } from '../../../shared/config';

/**
 * Sincroniza el catálogo de market listings (Buff163 + YouPin) desde la API de cs2.sh.
 * Guarda el proveedor real, ambos precios (ask de youpin y buff) y detecta cuál tiene
 * mejor liquidez para usarlo como precio base.
 */
export class SyncMarketListingsUseCase {
  constructor(private marketRepository: IMarketRepository) {}

  async execute(): Promise<{ synced: number; skipped: number }> {
    const apiKey = config.cs2ShApiKey;
    if (!apiKey) {
      console.warn('[Market Sync] CS2_SH_API_KEY no configurado. Sincronización omitida.');
      return { synced: 0, skipped: 0 };
    }

    console.log('[Market Sync] Obteniendo catálogo completo desde cs2.sh...');

    const response = await fetch('https://api.cs2.sh/v1/prices/latest', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`[Market Sync] cs2.sh respondió con error ${response.status}`);
    }

    const responseData = (await response.json()) as any;
    const itemsMap: Record<string, any> = responseData.items || responseData || {};

    // Obtener imágenes de ByMykel para enriquecer los listings
    const imagesMap = await PriceEnrichmentService.fetchByMykelSkinsImages();

    const listings: MarketListingUpsert[] = [];
    let skipped = 0;

    for (const [name, itemData] of Object.entries(itemsMap)) {
      const data = itemData as any;

      const youpinAsk: number | null = data.youpin?.ask || null;
      const youpinVolume: number | null = data.youpin?.ask_volume || null;
      const buffAsk: number | null = data.buff?.ask || null;
      const buffVolume: number | null = data.buff?.ask_volume || null;

      const totalVolume = (youpinVolume ?? 0) + (buffVolume ?? 0);

      // Filtrar por liquidez mínima (al menos 2 ofertas activas en total)
      if (totalVolume < 2) {
        skipped++;
        continue;
      }

      // Determinar el mejor proveedor: preferimos YouPin si tiene precio,
      // sino usamos Buff. El precio base es el del proveedor con mejor volumen.
      let provider: 'buff' | 'youpin';
      let price: number;

      if (youpinAsk && youpinVolume && (!buffAsk || youpinVolume >= (buffVolume ?? 0))) {
        provider = 'youpin';
        price = youpinAsk;
      } else if (buffAsk) {
        provider = 'buff';
        price = buffAsk;
      } else {
        skipped++;
        continue;
      }

      // Descartar ítems sin precio o demasiado baratos
      if (price <= 0.5) {
        skipped++;
        continue;
      }

      const details = PriceEnrichmentService.inferDetailsFromMarketHashName(name);
      const cleanBaseName = PriceEnrichmentService.cleanNameForImageLookup(name);
      const iconUrl =
        imagesMap.get(name) ||
        imagesMap.get(cleanBaseName) ||
        imagesMap.get('★ ' + cleanBaseName) ||
        imagesMap.get(cleanBaseName.replace('★ ', '')) ||
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
    }

    if (listings.length === 0) {
      console.warn('[Market Sync] No se obtuvieron listings con liquidez suficiente.');
      return { synced: 0, skipped };
    }

    await this.marketRepository.replaceAll(listings);
    console.log(`[Market Sync] Sincronizados ${listings.length} listings (${skipped} omitidos por baja liquidez).`);

    return { synced: listings.length, skipped };
  }
}
