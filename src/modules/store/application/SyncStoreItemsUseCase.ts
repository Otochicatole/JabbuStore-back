import { StoreItem } from '../domain/Item';
import { IStoreRepository } from '../domain/IStoreRepository';
import { BotService } from '../../marketplace/application/BotService';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';

export class SyncStoreItemsUseCase {
  constructor(private storeRepository: IStoreRepository) {}

  async execute(): Promise<void> {
    const appId = 730; // AppID de CS:GO / CS2
    const contextId = 2; // ContextID para inventario de skins

    const bots = await BotService.getAllBots();
    const activeBots = bots.filter(bot => bot.isActive);

    const fetchPromises = activeBots.map(async (bot) => {
      const steamId = bot.steamId;
      const steamUrl = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=english&count=2000`;
      
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

    // Filtrar únicamente artículos que son intercambiables
    const tradableAggregatedItems = aggregatedItems.filter(item => item.tradable === true);

    if (tradableAggregatedItems.length === 0) {
      console.warn(`[Store Inventory Sync] No se obtuvieron ítems intercambiables de los bots.`);
      if (activeBots.length > 0) {
        console.warn(`[Store Inventory Sync] Hay bots activos pero sin ítems. Omitiendo sync para preservar datos actuales.`);
        return;
      }
    }

    // Enriquecer ítems de bots con precios reales de mercado via cs2.sh
    let botItems: any[] = [];
    if (tradableAggregatedItems.length > 0) {
      console.log(`[Store Inventory Sync] ${tradableAggregatedItems.length} ítems intercambiables. Obteniendo precios de mercado...`);
      const pricedItems = await PriceEnrichmentService.enrichItemsWithMarketPrices(tradableAggregatedItems);

      // Deduplicar por assetId
      const uniqueMap = new Map<string, any>();
      for (const item of pricedItems) {
        uniqueMap.set(item.assetId, item);
      }
      botItems = Array.from(uniqueMap.values());
    }

    // Protección: si no hay ítems y hay bots activos, no limpiar la DB
    if (botItems.length === 0 && activeBots.length > 0) {
      console.warn(`[Store Inventory Sync] Sin ítems de bots. Omitiendo sync para preservar datos actuales.`);
      return;
    }

    console.log(`[Store Inventory Sync] Guardando ${botItems.length} ítems de bots en la base de datos...`);
    await this.storeRepository.clearAndSaveMany(botItems);
    console.log(`[Store Inventory Sync] Sincronización completada.`);
  }

  private parseSteamInventory(data: any, botSteamId: string): StoreItem[] {
    if (!data || !data.assets || !data.descriptions) return [];

    const descriptionsMap = new Map<string, any>(
      data.descriptions.map((desc: any) => [String(desc.classid), desc])
    );

    // Parsear asset_properties para obtener floats y patterns exactos provistos por Steam
    const assetPropertiesMap = new Map<string, { float: number | null, pattern: number | null, paintIndex: number | null }>();
    if (data.asset_properties) {
      const propertiesList = Array.isArray(data.asset_properties)
        ? data.asset_properties
        : Object.values(data.asset_properties);

      for (const entry of propertiesList as any[]) {
        if (!entry || !entry.assetid || !entry.asset_properties) continue;
        
        let float: number | null = null;
        let pattern: number | null = null;
        let paintIndex: number | null = null;

        for (const prop of entry.asset_properties) {
          if (prop.propertyid === 1) {
            pattern = prop.int_value ? parseInt(prop.int_value, 10) : null;
          } else if (prop.propertyid === 2) {
            float = prop.float_value ? parseFloat(prop.float_value) : null;
          } else if (prop.propertyid === 7) {
            paintIndex = prop.int_value ? parseInt(prop.int_value, 10) : null;
          }
        }
        assetPropertiesMap.set(String(entry.assetid), { float, pattern, paintIndex });
      }
    }

    return data.assets.map((asset: any) => {
      const description: any = descriptionsMap.get(asset.classid);
      const type = description?.type || '';
      
      const details = PriceEnrichmentService.parseItemDetails(description, asset.assetid);

      // Obtener float y pattern exactos desde la propiedad de Steam si existen
      const propData = assetPropertiesMap.get(String(asset.assetid));
      const floatVal = propData?.float !== undefined ? propData.float : details.float;
      const patternVal = propData?.pattern !== undefined ? propData.pattern : details.pattern;
      const paintIndexVal = propData?.paintIndex !== undefined ? propData.paintIndex : null;

      let rawName = description?.market_hash_name || description?.name || '';

      // Detect Doppler phase and append to name if applicable
      const iconHash = description?.icon_url || null;
      const detectedPhase = PriceEnrichmentService.detectDopplerPhase(rawName, iconHash, paintIndexVal);
      if (detectedPhase) {
        const phaseMapping: Record<string, string> = {
          phase1: 'Phase 1',
          phase2: 'Phase 2',
          phase3: 'Phase 3',
          phase4: 'Phase 4',
          ruby: 'Ruby',
          sapphire: 'Sapphire',
          blackpearl: 'Black Pearl',
          emerald: 'Emerald'
        };
        const phaseDisplayName = phaseMapping[detectedPhase];
        if (phaseDisplayName && !rawName.includes(phaseDisplayName)) {
          rawName = `${rawName} | ${phaseDisplayName}`;
        }
      }

      return {
        assetId: asset.assetid,
        classId: asset.classid,
        name: rawName,
        type: type,
        iconUrl: description?.icon_url
          ? `https://community.cloudflare.steamstatic.com/economy/image/${description.icon_url}`
          : null,
        tradable: description?.tradable === 1,
        marketable: description?.marketable === 1,
        botSteamId: botSteamId,
        price: 0, // Se actualizará en el siguiente paso de enriquecimiento
        ...details,
        float: floatVal,
        pattern: patternVal,
      };
    });
  }
}
