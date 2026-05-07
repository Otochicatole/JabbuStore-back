import { StoreItem } from '../domain/Item';
import { IStoreRepository } from '../domain/IStoreRepository';
import { storeAccounts } from '../../../storeAccounts';
import { config } from '../../../shared/config';

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

    // Si no pudimos conseguir ningún ítem en absoluto debido a fallos totales o rate limits globales,
    // es mejor NO limpiar la base de datos (para no dejar la tienda vacía)
    if (aggregatedItems.length === 0 && storeAccounts.length > 0) {
      console.warn(`[Store Inventory Sync] No items retrieved from any bot. Skipping DB clearance to preserve existing catalog.`);
      return;
    }

    console.log(`[Store Inventory Sync] Retrieved ${aggregatedItems.length} items from bots. Fetching market prices...`);

    // Obtener los precios de mercado reales usando la API cs2.sh
    const pricedItems = await this.enrichItemsWithMarketPrices(aggregatedItems);

    // Filtrar duplicados por assetId para evitar errores de Unique Constraint en la base de datos
    const uniqueItemsMap = new Map<string, StoreItem>();
    for (const item of pricedItems) {
      uniqueItemsMap.set(item.assetId, item);
    }
    const finalPricedItems = Array.from(uniqueItemsMap.values());

    console.log(`[Store Inventory Sync] Saving ${finalPricedItems.length} unique items with real prices to database...`);
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

  private async enrichItemsWithMarketPrices(items: StoreItem[]): Promise<StoreItem[]> {
    const apiKey = config.cs2ShApiKey;
    
    // Obtener nombres únicos de mercado para consultar a la API de cs2.sh
    const uniqueHashNames = Array.from(new Set(items.map(item => item.name).filter(Boolean)));
    const pricesMap = new Map<string, number>();

    if (!apiKey) {
      console.warn(`[Store Inventory Sync] CS2_SH_API_KEY is not set in .env. Falling back to deterministic simulation prices.`);
    } else {
      console.log(`[Store Inventory Sync] Querying cs2.sh latest prices for ${uniqueHashNames.length} unique items...`);
      
      // La API cs2.sh permite consultar un máximo de 100 ítems por request POST
      const chunkSize = 100;
      for (let i = 0; i < uniqueHashNames.length; i += chunkSize) {
        const chunk = uniqueHashNames.slice(i, i + chunkSize);
        try {
          const response = await fetch('https://api.cs2.sh/v1/prices/latest', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Accept-Encoding': 'gzip',
            },
            body: JSON.stringify({ items: chunk }),
          });

          if (!response.ok) {
            console.error(`[Store Inventory Sync] cs2.sh API returned error status ${response.status} for chunk ${i / chunkSize + 1}`);
            continue;
          }

          const responseData = (await response.json()) as any;
          if (responseData && responseData.items) {
            for (const itemName of chunk) {
              const itemPriceData = responseData.items[itemName];
              if (itemPriceData) {
                const price = this.determinePriceFromData(itemPriceData);
                if (price > 0) {
                  pricesMap.set(itemName, price);
                }
              }
            }
          }
        } catch (error) {
          console.error(`[Store Inventory Sync Error] Failed to fetch prices from cs2.sh for chunk ${i / chunkSize + 1}:`, error);
        }
      }
    }

    // Enriquecer cada ítem con el precio obtenido de la API o con el fallback determinista
    return items.map(item => {
      let finalPrice = pricesMap.get(item.name) || 0;
      
      if (finalPrice === 0) {
        // Fallback determinista idéntico al del Frontend
        finalPrice = this.calculateFallbackPrice(item.type, item.classId, item.assetId);
      }

      return {
        ...item,
        price: finalPrice,
      };
    });
  }

  private determinePriceFromData(itemPriceData: any): number {
    if (!itemPriceData) return 0;
    
    // 1. Buff163 es el estándar de oro de precios en efectivo de CS2 (BUFF)
    if (itemPriceData.buff?.ask) {
      return itemPriceData.buff.ask;
    }
    
    // 2. CSFloat es el segundo mercado en efectivo con más volumen y precios realistas
    if (itemPriceData.csfloat?.ask) {
      return itemPriceData.csfloat.ask;
    }
    
    // 3. Skinport es una excelente referencia europea
    if (itemPriceData.skinport?.ask) {
      return itemPriceData.skinport.ask;
    }
    
    // 4. Steam Community Market está inflado por comisiones, aplicamos descuento de ~30%
    if (itemPriceData.steam?.ask) {
      return Math.round(itemPriceData.steam.ask * 0.7 * 100) / 100;
    }
    
    // 5. C5Game
    if (itemPriceData.c5game?.ask) {
      return itemPriceData.c5game.ask;
    }
    
    // 6. Youpin
    if (itemPriceData.youpin?.ask) {
      return itemPriceData.youpin.ask;
    }
    
    return 0;
  }

  private calculateFallbackPrice(type: string, classId: string, assetId: string): number {
    const rarity = this.getRarityFromType(type, classId);
    let basePrice = 5;
    if (rarity === 'ancient') basePrice = 1200;
    else if (rarity === 'legendary') basePrice = 280;
    else if (rarity === 'mythical') basePrice = 85;
    else if (rarity === 'rare') basePrice = 30;
    else if (rarity === 'uncommon') basePrice = 12;

    const variance = (this.hashCode(assetId) % 100) / 100; // 0.0 to 1.0
    const finalPrice = Math.round(basePrice * (0.8 + variance * 0.4) * 100) / 100; // variance of +/-20%
    return finalPrice;
  }

  private getRarityFromType(type: string, classId: string): string {
    const typeLower = type.toLowerCase();
    if (
      typeLower.includes("encubierto") || 
      typeLower.includes("covert") || 
      typeLower.includes("cuchillo") || 
      typeLower.includes("knife") || 
      typeLower.includes("guantes") || 
      typeLower.includes("gloves") || 
      typeLower.includes("extraordinario") || 
      typeLower.includes("contrabando")
    ) {
      return 'ancient';
    } else if (typeLower.includes("clasificado") || typeLower.includes("classified")) {
      return 'legendary';
    } else if (typeLower.includes("restringido") || typeLower.includes("restricted")) {
      return 'mythical';
    } else if (typeLower.includes("militar") || typeLower.includes("mil-spec")) {
      return 'rare';
    } else if (typeLower.includes("industrial")) {
      return 'uncommon';
    } else if (typeLower.includes("consumo") || typeLower.includes("consumer")) {
      return 'common';
    } else {
      const rarities = ['common', 'uncommon', 'rare', 'mythical', 'legendary', 'ancient'];
      const index = Math.abs(this.hashCode(classId)) % rarities.length;
      return rarities[index] || 'common';
    }
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}
