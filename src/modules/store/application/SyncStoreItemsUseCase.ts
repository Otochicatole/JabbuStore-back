import { StoreItem } from '../domain/Item';
import { IStoreRepository } from '../domain/IStoreRepository';
import { storeAccounts } from '../../../storeAccounts';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';

export class SyncStoreItemsUseCase {
  constructor(private storeRepository: IStoreRepository) {}

  async execute(): Promise<void> {
    const appId = 730; // AppID de CS:GO / CS2
    const contextId = 2; // ContextID para inventario de skins

    const fetchPromises = storeAccounts.map(async (steamId) => {
      const steamUrl = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=spanish&count=2000`;
      
      console.log(`[Store Inventory Sync] Fetching inventory for bot: ${steamId}`);
      
      const response = await fetch(steamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://steamcommunity.com',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch inventory for bot ${steamId}: ${response.statusText} (${response.status})`);
      }

      const data = (await response.json()) as any;
      return { steamId, data };
    });

    const results = await Promise.allSettled(fetchPromises);
    const aggregatedItems: StoreItem[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { steamId, data } = result.value;
        const parsedItems = this.parseSteamInventory(data, steamId);
        aggregatedItems.push(...parsedItems);
      } else {
        console.error(`[Store Inventory Sync Error] Failed to fetch bot inventory:`, result.reason);
      }
    }

    // Filtrar únicamente artículos que son intercambiables (Enfoque B)
    const tradableAggregatedItems = aggregatedItems.filter(item => item.tradable === true);

    // Si no pudimos conseguir ningún ítem en absoluto debido a fallos totales o rate limits globales,
    // es mejor NO limpiar la base de datos (para no dejar la tienda vacía)
    if (tradableAggregatedItems.length === 0 && storeAccounts.length > 0) {
      console.warn(`[Store Inventory Sync] No tradable items retrieved from any bot. Skipping DB clearance to preserve existing catalog.`);
      return;
    }

    console.log(`[Store Inventory Sync] Retrieved ${tradableAggregatedItems.length} tradable items from bots. Fetching market prices...`);

    // Obtener los precios de mercado reales usando el PriceEnrichmentService
    const pricedItems = await PriceEnrichmentService.enrichItemsWithMarketPrices(tradableAggregatedItems);

    // Filtrar duplicados por assetId para evitar errores de Unique Constraint en la base de datos
    const uniqueItemsMap = new Map<string, StoreItem>();
    for (const item of pricedItems) {
      uniqueItemsMap.set(item.assetId, item);
    }
    const finalPricedItems = Array.from(uniqueItemsMap.values());

    console.log(`[Store Inventory Sync] Saving ${finalPricedItems.length} unique tradable items with real prices to database...`);
    await this.storeRepository.clearAndSaveMany(finalPricedItems);
    console.log(`[Store Inventory Sync] Database sync completed successfully!`);
  }

  private parseSteamInventory(data: any, botSteamId: string): StoreItem[] {
    if (!data || !data.assets || !data.descriptions) return [];

    const descriptionsMap = new Map(
      data.descriptions.map((desc: any) => [desc.classid, desc])
    );

    return data.assets.map((asset: any) => {
      const description: any = descriptionsMap.get(asset.classid);
      const type = description?.type || '';

      return {
        assetId: asset.assetid,
        classId: asset.classid,
        name: description?.market_hash_name || description?.name || '',
        type: type,
        iconUrl: description?.icon_url
          ? `https://community.cloudflare.steamstatic.com/economy/image/${description.icon_url}`
          : null,
        tradable: description?.tradable === 1,
        marketable: description?.marketable === 1,
        botSteamId: botSteamId,
        price: 0, // Se actualizará en el siguiente paso de enriquecimiento
      };
    });
  }
}
