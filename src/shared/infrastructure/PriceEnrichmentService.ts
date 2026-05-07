import { config } from '../config';

export interface PriceableItem {
  assetId: string;
  classId: string;
  name: string;
  type: string;
  price: number;
}

export class PriceEnrichmentService {
  /**
   * Enriquecer una lista de artículos con precios del mercado real (vía cs2.sh) o fallbacks deterministas.
   */
  static async enrichItemsWithMarketPrices<T extends PriceableItem>(items: T[]): Promise<T[]> {
    const apiKey = config.cs2ShApiKey;
    
    // Obtener nombres únicos de mercado para consultar a la API de cs2.sh
    const uniqueHashNames = Array.from(new Set(items.map(item => item.name).filter(Boolean)));
    const pricesMap = new Map<string, number>();

    if (!apiKey) {
      console.warn(`[Price Enrichment Service] CS2_SH_API_KEY is not set in .env. Falling back to deterministic simulation prices.`);
    } else {
      console.log(`[Price Enrichment Service] Querying cs2.sh latest prices for ${uniqueHashNames.length} unique items...`);
      
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
            console.error(`[Price Enrichment Service] cs2.sh API returned error status ${response.status} for chunk ${i / chunkSize + 1}`);
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
          console.error(`[Price Enrichment Service Error] Failed to fetch prices from cs2.sh for chunk ${i / chunkSize + 1}:`, error);
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

  private static determinePriceFromData(itemPriceData: any): number {
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

  private static calculateFallbackPrice(type: string, classId: string, assetId: string): number {
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

  private static getRarityFromType(type: string, classId: string): string {
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

  private static hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}
