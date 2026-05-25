import { config } from '../config';

export interface PriceableItem {
  assetId: string;
  classId: string;
  name: string;
  type: string;
  price: number;
}

export class PriceEnrichmentService {
  private static byMykelImagesMap: Map<string, string> | null = null;

  /**
   * Detectar la fase exacta de un Doppler o Gamma Doppler usando icon_url o el paintIndex oficial de CS2
   */
  static detectDopplerPhase(marketHashName: string, iconUrl: string | null, paintIndex?: number | null): string | null {
    if (!marketHashName) return null;
    if (!marketHashName.includes('Doppler')) return null;

    // 1. Detección exacta mediante Paint Index (Finish Catalog) si está disponible
    if (paintIndex !== undefined && paintIndex !== null) {
      const paintIndexMap: Record<number, string> = {
        // Doppler Gen 1
        418: 'phase1', 419: 'phase2', 420: 'phase3', 421: 'phase4',
        415: 'ruby', 416: 'sapphire', 417: 'blackpearl',
        // Doppler Gen 2 (Spectrum: Butterfly, Huntsman, Falchion, Shadow Daggers, Bowie)
        618: 'phase2', 619: 'sapphire', 617: 'blackpearl',
        // Doppler Gen 3 (Prisma: Talon, Ursus, Navaja, Stiletto)
        852: 'phase1', 853: 'phase2', 854: 'phase3', 855: 'phase4',
        849: 'ruby', 850: 'sapphire', 851: 'blackpearl',
        
        // Gamma Doppler Gen 1
        569: 'phase1', 570: 'phase2', 571: 'phase3', 572: 'phase4',
        568: 'emerald',
        // Gamma Doppler Gen 2 (Dreams & Nightmares, etc)
        1119: 'phase1', 1120: 'phase2', 1121: 'phase3', 1122: 'phase4',
        1118: 'emerald',
      };
      if (paintIndexMap[paintIndex]) {
        return paintIndexMap[paintIndex];
      }
    }

    // 2. Intentar usar la librería offline si el hash tiene el formato clásico de CS:GO (-9a8)
    if (iconUrl && iconUrl.startsWith('-9a8')) {
      try {
        const dopplerPhaseDetector = require('csgo-doppler-phase');
        let cleanIconUrl = iconUrl;
        if (iconUrl.includes('economy/image/')) {
          cleanIconUrl = iconUrl.split('economy/image/')[1] || iconUrl;
        }

        const detected = dopplerPhaseDetector.detect(marketHashName, cleanIconUrl);
        if (detected && typeof detected === 'string' && !detected.startsWith('Something wrong')) {
          return detected;
        }
      } catch (error) {
        console.error('[PriceEnrichmentService] Error detecting Doppler phase via library:', error);
      }
    }

    return null;
  }

  /**
   * Descompone un nombre completo de ítem (con fase opcional añadida) en el nombre base de mercado y la fase.
   */
  static getBaseNameAndPhase(fullName: string): { baseName: string; phase: string | null } {
    if (!fullName) return { baseName: '', phase: null };

    const parts = fullName.split(' | ');
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1]!;
      const phaseNames = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Ruby', 'Sapphire', 'Black Pearl', 'Emerald'];
      if (phaseNames.includes(lastPart)) {
        const baseName = parts.slice(0, -1).join(' | ');
        return { baseName, phase: lastPart };
      }
    }
    return { baseName: fullName, phase: null };
  }

  /**
   * Enriquecer una lista de artículos con precios del mercado real (vía cs2.sh) o fallbacks deterministas.
   */
  static async enrichItemsWithMarketPrices<T extends PriceableItem>(items: T[]): Promise<T[]> {
    const apiKey = config.cs2ShApiKey;
    
    // Obtener nombres base de mercado únicos para consultar a la API de cs2.sh (evitando nombres con fase agregada)
    const uniqueBaseNamesMap = new Map<string, string>(); // fullName -> baseName
    for (const item of items) {
      if (item.name) {
        const { baseName } = this.getBaseNameAndPhase(item.name);
        uniqueBaseNamesMap.set(item.name, baseName);
      }
    }
    const uniqueBaseNames = Array.from(new Set(uniqueBaseNamesMap.values())).filter(Boolean);
    const pricesMap = new Map<string, number>();

    if (!apiKey) {
      console.warn(`[Price Enrichment Service] CS2_SH_API_KEY is not set in .env. Falling back to deterministic simulation prices.`);
    } else {
      console.log(`[Price Enrichment Service] Querying cs2.sh latest prices for ${uniqueBaseNames.length} unique base items...`);
      
      // La API cs2.sh permite consultar un máximo de 100 ítems por request POST
      const chunkSize = 100;
      for (let i = 0; i < uniqueBaseNames.length; i += chunkSize) {
        const chunk = uniqueBaseNames.slice(i, i + chunkSize);
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
            // Mapear los precios de vuelta a los ítems originales (incluyendo soporte para fases)
            for (const item of items) {
              const baseInfo = this.getBaseNameAndPhase(item.name);
              const itemPriceData = responseData.items[baseInfo.baseName];
              if (itemPriceData) {
                let price = 0;
                // Si el ítem original tiene una fase detectada y cs2.sh tiene esa fase en sus variantes
                if (baseInfo.phase && itemPriceData.variants && itemPriceData.variants[baseInfo.phase]) {
                  price = this.determinePriceFromData(itemPriceData.variants[baseInfo.phase]);
                } else {
                  price = this.determinePriceFromData(itemPriceData);
                }

                if (price > 0) {
                  pricesMap.set(item.name, price);
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
    
    // Si contiene variantes (como Dopplers Phase 1-4, Ruby, Emerald, Marble Fades, etc.)
    if (itemPriceData.variants && typeof itemPriceData.variants === 'object') {
      const variantPrices: number[] = [];
      for (const variantKey of Object.keys(itemPriceData.variants)) {
        const variantData = itemPriceData.variants[variantKey];
        const price = this.determinePriceFromData(variantData);
        if (price > 0) {
          variantPrices.push(price);
        }
      }
      if (variantPrices.length > 0) {
        // Retornamos el promedio de los precios reales de las variantes
        const sum = variantPrices.reduce((a, b) => a + b, 0);
        return Math.round((sum / variantPrices.length) * 100) / 100;
      }
    }
    
    // Usar únicamente precios de Youpin
    if (itemPriceData.youpin?.ask) {
      return itemPriceData.youpin.ask;
    }
    
    return 0;
  }

  static parseItemDetails(description: any, assetId?: string): {
    rarity: string;
    exterior: string | null;
    category: string;
    isStatTrak: boolean;
    isSouvenir: boolean;
    float: number | null;
    pattern: number | null;
  } {
    const typeStr = description?.type || '';
    const name = description?.market_hash_name || description?.name || '';
    const tags = description?.tags || [];

    // 1. Rarity
    const rarity = this.getRarityFromType(typeStr, description?.classid || '');

    // 2. Exterior / Wear (desde tags)
    const exteriorTag = tags.find((t: any) => t.category === 'Exterior');
    const exterior = exteriorTag ? exteriorTag.localized_tag_name : null;

    // 3. Category / Slot de arma
    let category = 'other';
    const typeLower = typeStr.toLowerCase();
    if (typeLower.includes('cuchillo') || typeLower.includes('knife')) {
      category = 'knife';
    } else if (typeLower.includes('guantes') || typeLower.includes('gloves')) {
      category = 'gloves';
    } else {
      const weaponTag = tags.find((t: any) => t.category === 'Weapon' || t.category === 'Type');
      if (weaponTag) {
        const tagName = (weaponTag.localized_tag_name || weaponTag.internal_name || '').toLowerCase();
        if (['ak-47', 'm4a4', 'm4a1-s', 'awp', 'scout', 'ssg 08', 'sg 553', 'aug', 'galil', 'famas', 'g3sg1', 'scar-20'].some(r => tagName.includes(r))) {
          category = 'rifle';
        } else if (['pistola', 'pistol', 'glock-18', 'usp-s', 'desert eagle', 'deagle', 'p250', 'cz75', 'five-seven', 'tec-9', 'dual berettas', 'revolver'].some(p => tagName.includes(p))) {
          category = 'pistol';
        } else if (['subfusil', 'smg', 'mac-10', 'mp9', 'mp7', 'mp5', 'ump-45', 'p90', 'bizon'].some(s => tagName.includes(s))) {
          category = 'smg';
        } else if (['escopeta', 'shotgun', 'nova', 'xm1014', 'mag-7', 'sawed-off', 'negev', 'm249'].some(sh => tagName.includes(sh))) {
          category = 'heavy';
        }
      }
    }

    // Fallbacks si las etiquetas de Steam son demasiado estrictas o están ausentes
    if (category === 'other') {
      if (typeLower.includes('rifle') || typeLower.includes('fusil')) category = 'rifle';
      else if (typeLower.includes('pistol') || typeLower.includes('pistola')) category = 'pistol';
      else if (typeLower.includes('subfusil') || typeLower.includes('smg')) category = 'smg';
      else if (typeLower.includes('knife') || typeLower.includes('cuchillo')) category = 'knife';
      else if (typeLower.includes('gloves') || typeLower.includes('guantes')) category = 'gloves';
      else if (typeLower.includes('sticker') || typeLower.includes('pegatina')) category = 'sticker';
    }

    // 4. StatTrak & Souvenir
    const isStatTrak = name.includes('StatTrak™') || name.includes('StatTrak');
    const isSouvenir = name.includes('Souvenir');

    return {
      rarity,
      exterior,
      category,
      isStatTrak,
      isSouvenir,
      float: null,
      pattern: null,
    };
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

  static getRarityFromType(type: string, classId: string): string {
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

  static inferDetailsFromMarketHashName(name: string): {
    type: string;
    rarity: string;
    exterior: string | null;
    category: string;
    isStatTrak: boolean;
    isSouvenir: boolean;
  } {
    const nameLower = name.toLowerCase();
    
    // Exterior
    let exterior: string | null = null;
    if (name.includes('(Factory New)')) exterior = 'Factory New';
    else if (name.includes('(Minimal Wear)')) exterior = 'Minimal Wear';
    else if (name.includes('(Field-Tested)')) exterior = 'Field-Tested';
    else if (name.includes('(Well-Worn)')) exterior = 'Well-Worn';
    else if (name.includes('(Battle-Scarred)')) exterior = 'Battle-Scarred';

    // Rarity & Category
    let rarity = 'common';
    let category = 'other';
    let type = 'Weapon';

    const isKnife = name.includes('★') || ['knife', 'bayonet', 'karambit', 'flip', 'gut', 'falchion', 'bowie', 'huntsman', 'talon', 'ursus', 'stiletto', 'navaja', 'nomad', 'survival', 'paracord', 'skeleton'].some(k => nameLower.includes(k));
    const isGloves = ['gloves', 'wraps'].some(g => nameLower.includes(g));

    if (isKnife) {
      rarity = 'ancient';
      category = 'knife';
      type = '★ Knife';
    } else if (isGloves) {
      rarity = 'ancient';
      category = 'gloves';
      type = '★ Gloves';
    } else {
      if (['ak-47', 'm4a4', 'm4a1-s', 'awp', 'scout', 'ssg 08', 'sg 553', 'aug', 'galil', 'famas', 'g3sg1', 'scar-20'].some(r => nameLower.includes(r))) {
        category = 'rifle';
        type = 'Rifle';
        rarity = nameLower.includes('ak-47') || nameLower.includes('awp') || nameLower.includes('m4a') ? 'legendary' : 'mythical';
      } else if (['glock-18', 'usp-s', 'desert eagle', 'deagle', 'p250', 'cz75', 'five-seven', 'tec-9', 'dual berettas', 'revolver'].some(p => nameLower.includes(p))) {
        category = 'pistol';
        type = 'Pistol';
        rarity = nameLower.includes('desert eagle') || nameLower.includes('usp-s') ? 'mythical' : 'rare';
      } else if (['mac-10', 'mp9', 'mp7', 'mp5', 'ump-45', 'p90', 'bizon'].some(s => nameLower.includes(s))) {
        category = 'smg';
        type = 'SMG';
        rarity = 'rare';
      } else if (['nova', 'xm1014', 'mag-7', 'sawed-off', 'negev', 'm249'].some(sh => nameLower.includes(sh))) {
        category = 'heavy';
        type = 'Heavy';
        rarity = 'uncommon';
      }
    }

    const isStatTrak = name.includes('StatTrak™') || name.includes('StatTrak');
    const isSouvenir = name.includes('Souvenir');

    return {
      type,
      rarity,
      exterior,
      category,
      isStatTrak,
      isSouvenir
    };
  }

  static cleanNameForImageLookup(name: string): string {
    if (!name) return '';
    let clean = name;

    // 1. Quitar el exterior entre paréntesis al final (ej. " (Factory New)", " (Field-Tested)")
    const exteriorMatch = clean.match(/\s*\([^)]+\)\s*$/);
    if (exteriorMatch) {
      clean = clean.replace(exteriorMatch[0], '');
    }

    // 2. Quitar Doppler phases al final
    const phaseNames = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Ruby', 'Sapphire', 'Black Pearl', 'Emerald'];
    for (const phase of phaseNames) {
      if (clean.endsWith(` | ${phase}`)) {
        clean = clean.substring(0, clean.length - (phase.length + 3));
        break;
      }
    }

    // 3. Eliminar prefijos clásicos de mercado de Steam
    clean = clean.replace(/^★\s+/, ''); // Quitar estrella de cuchillos/guantes
    clean = clean.replace(/^StatTrak™\s+/, ''); // Quitar StatTrak
    clean = clean.replace(/^Souvenir\s+/, ''); // Quitar Souvenir

    return clean.trim();
  }

  static async fetchByMykelSkinsImages(): Promise<Map<string, string>> {
    if (this.byMykelImagesMap) return this.byMykelImagesMap;

    const map = new Map<string, string>();
    const endpoints = [
      'skins.json',
      'stickers.json',
      'crates.json',
      'agents.json',
      'music_kits.json',
      'patches.json',
      'keys.json',
      'graffiti.json',
      'collectibles.json'
    ];

    console.log(`[Price Enrichment Service] Loading skin, sticker, agent, patch, crate & music images from ByMykel API...`);

    const promises = endpoints.map(async (file) => {
      const url = `https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/${file}`;
      const response = await fetch(url);
      if (response.ok) {
        return { file, data: (await response.json()) as any[] };
      }
      throw new Error(`Failed to fetch ${file}`);
    });

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { file, data } = result.value;
        let count = 0;
        for (const item of data) {
          if (item && item.name && item.image) {
            // Mapeo 1: Nombre original de ByMykel
            map.set(item.name, item.image);

            // Mapeo 2: Nombre de ByMykel limpio
            const cleanMykelName = this.cleanNameForImageLookup(item.name);
            if (cleanMykelName && cleanMykelName !== item.name) {
              map.set(cleanMykelName, item.image);
            }
            count++;
          }
        }
        console.log(`  -> Loaded ${count} mappings from ${file}`);
      } else {
        console.warn(`[Price Enrichment Service] Failed to load some image mappings:`, result.reason);
      }
    }

    this.byMykelImagesMap = map;
    console.log(`[Price Enrichment Service] Loaded total of ${map.size} unique image mappings from ByMykel.`);
    return map;
  }

  /**
   * Fetchea todas las skins con sus precios Youpin y Buff desde cs2.sh,
   * y las formatea como ítems de reventa (isImmediate = false).
   */
  static async fetchAllResellItemsFromMarket(): Promise<any[]> {
    const apiKey = config.cs2ShApiKey;
    if (!apiKey) {
      console.warn(`[Price Enrichment Service] CS2_SH_API_KEY is not set. Resell catalog cannot be loaded.`);
      return [];
    }

    try {
      console.log(`[Price Enrichment Service] Fetching complete resell catalog from cs2.sh...`);
      const response = await fetch('https://api.cs2.sh/v1/prices/latest', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        console.error(`[Price Enrichment Service] cs2.sh returned error status: ${response.status}`);
        return [];
      }

      const responseData = (await response.json()) as any;
      const itemsMap = responseData.items || responseData || {};
      const resellItems: any[] = [];

      // Obtener mapas de imágenes estándar desde ByMykel
      const imagesMap = await this.fetchByMykelSkinsImages();

      for (const [name, itemData] of Object.entries(itemsMap)) {
        const data = itemData as any;
        const youpinVolume = data.youpin?.ask_volume || 0;
        const buffVolume = data.buff?.ask_volume || 0;
        const youpinAsk = data.youpin?.ask || 0;
        const buffAsk = data.buff?.ask || 0;

        // Filtrar por volumen y liquidez mínima para no saturar la base de datos (mínimo 2 ofertas activas)
        if (youpinVolume + buffVolume < 2) continue;

        // Tomar el precio ask de Youpin prioritariamente, sino de Buff
        const basePrice = youpinAsk || buffAsk;
        if (!basePrice || basePrice <= 0.5) continue; // Descartar sin precio o demasiado baratos

        const details = this.inferDetailsFromMarketHashName(name);
        const safeId = `resell-${name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;

        // Limpiar el nombre para ByMykel de manera exhaustiva
        const cleanBaseName = this.cleanNameForImageLookup(name);

        // Buscar imagen en el mapa
        const iconUrl = imagesMap.get(name) || 
                        imagesMap.get(cleanBaseName) || 
                        imagesMap.get('★ ' + cleanBaseName) || 
                        imagesMap.get(cleanBaseName.replace('★ ', '')) || 
                        null;

        resellItems.push({
          assetId: safeId,
          classId: safeId,
          name,
          type: details.type,
          iconUrl,
          tradable: true,
          marketable: true,
          botSteamId: "resell_market",
          price: basePrice,
          isImmediate: false,
          isPriceManual: false,
          rarity: details.rarity,
          exterior: details.exterior,
          category: details.category,
          isStatTrak: details.isStatTrak,
          isSouvenir: details.isSouvenir,
          float: null,
          pattern: null,
        });
      }

      console.log(`[Price Enrichment Service] Successfully parsed ${resellItems.length} resell items from cs2.sh.`);
      return resellItems;
    } catch (error) {
      console.error(`[Price Enrichment Service] Error fetching resell items:`, error);
      return [];
    }
  }

}
