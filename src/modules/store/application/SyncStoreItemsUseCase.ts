import { StoreItem } from '../domain/Item';
import { IStoreRepository } from '../domain/IStoreRepository';
import { BotService } from '../../marketplace/application/BotService';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';
import { BotPriceSyncService } from '../../../modules/pricing';
import { config } from '../../../shared/config';
import {
  buildInspectLinkFromCertificateHex,
  normalizeSteamWebApiInspectLink,
} from '../../../shared/infrastructure/inspectLinkHelpers';

const botPriceSyncService = new BotPriceSyncService();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Global inventory API: 2 req/min en plan Float Small. */
const INVENTORY_API_GAP_MS = 31_000;
let lastInventoryApiCallAt = 0;

export class SyncStoreItemsUseCase {
  constructor(private storeRepository: IStoreRepository) {}

  /**
   * Obtiene inspect links resueltos (certificate hex) desde SteamWebAPI inventory.
   * El inventario crudo de Steam Community devuelve plantillas con %propid:N% que no funcionan in-game.
   */
  private async fetchInspectLinksByAssetId(
    botSteamId: string,
  ): Promise<Map<string, string>> {
    const apiKey = config.steamwebapiApiKey;
    const map = new Map<string, string>();
    if (!apiKey) return map;

    const elapsed = Date.now() - lastInventoryApiCallAt;
    if (lastInventoryApiCallAt > 0 && elapsed < INVENTORY_API_GAP_MS) {
      await sleep(INVENTORY_API_GAP_MS - elapsed);
    }

    const params = new URLSearchParams({
      key: apiKey,
      steam_id: botSteamId,
      game: 'cs2',
      parse: '1',
      with_no_tradable: '1',
      limit: '10000',
    });
    const url = `https://www.steamwebapi.com/steam/api/inventory?${params.toString()}`;

    try {
      lastInventoryApiCallAt = Date.now();
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(
          `[Store Inventory Sync] SteamWebAPI inventory HTTP ${res.status} para bot ${botSteamId}.`,
        );
        return map;
      }

      const data = await res.json();
      const items = Array.isArray(data) ? data : [];
      for (const item of items) {
        const assetId = String(item.assetid ?? item.asset_id ?? '');
        if (!assetId) continue;

        const fromApi = normalizeSteamWebApiInspectLink(item.inspectlink);
        const fromCert = item.float?.certificate
          ? buildInspectLinkFromCertificateHex(String(item.float.certificate))
          : null;
        const link = fromApi ?? fromCert;
        if (link) map.set(assetId, link);
      }

      console.log(
        `[Store Inventory Sync] ${map.size} inspect links para bot ${botSteamId}.`,
      );
    } catch (err: any) {
      console.warn(
        `[Store Inventory Sync] Error obteniendo inspect links para ${botSteamId}: ${err.message}`,
      );
    }

    return map;
  }

  async execute(): Promise<{
    itemsSynced: number;
    activeBots: number;
    skipped: boolean;
    message: string;
  }> {
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
    const failedInventories = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedInventories.length > 0) {
      for (const failure of failedInventories) {
        console.error(
          '[Store Inventory Sync Error] Failed to fetch bot inventory:',
          failure.reason,
        );
      }
      throw new Error(
        `Falló la descarga de ${failedInventories.length}/${activeBots.length} inventario(s) de bots; se preservó la tienda anterior.`,
      );
    }
    const aggregatedItems: StoreItem[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { steamId, data } = result.value;
        const inspectLinks = await this.fetchInspectLinksByAssetId(steamId);
        const parsedItems = this.parseSteamInventory(data, steamId, inspectLinks);
        aggregatedItems.push(...parsedItems);
      }
    }

    // Filtrar únicamente artículos que son intercambiables
    const tradableAggregatedItems = aggregatedItems.filter(item => item.tradable === true);

    if (tradableAggregatedItems.length === 0) {
      console.warn(`[Store Inventory Sync] No se obtuvieron ítems intercambiables de los bots.`);
      if (activeBots.length > 0) {
        console.warn(`[Store Inventory Sync] Hay bots activos pero sin ítems. Omitiendo sync para preservar datos actuales.`);
        return {
          itemsSynced: 0,
          activeBots: activeBots.length,
          skipped: true,
          message: 'No se encontraron ítems intercambiables en los bots activos.',
        };
      }
    }

    if (activeBots.length === 0) {
      console.log(
        '[Store Inventory Sync] No hay bots activos. Limpiando StoreItem en DB...',
      );
      await this.storeRepository.clearAndSaveMany([]);
      await BotService.updateInventoryCounts(new Map());
      return {
        itemsSynced: 0,
        activeBots: 0,
        skipped: false,
        message: 'No hay bots activos; inventario de tienda vaciado.',
      };
    }

    // Enriquecer ítems de bots con precios del catálogo local Items API
    let botItems: any[] = [];
    if (tradableAggregatedItems.length > 0) {
      console.log(`[Store Inventory Sync] ${tradableAggregatedItems.length} ítems intercambiables. Obteniendo precios desde catálogo local Items API...`);

      const existingItems = await this.storeRepository.findAll();
      const existingByAsset = new Map(
        existingItems.map((item) => [item.assetId, item]),
      );
      const itemsWithPreviousCatalogPrice = tradableAggregatedItems.map(
        (item) => {
          const previous = existingByAsset.get(item.assetId);
          return previous && previous.price > 0
            ? { ...item, price: previous.price }
            : item;
        },
      );

      const { items: pricedItems, catalogAvailable } =
        await botPriceSyncService.enrichItems(itemsWithPreviousCatalogPrice, {
          forceRefreshCatalog: false,
          preserveExistingWhenMissing: true,
          preserveSuspiciousExistingPrice: false,
          // El job de bots fija precios únicamente desde
          // items-catalog.json; no inventa precios locales para faltantes.
          useFallbackWhenMissing: false,
          logWarnings: true,
        });

      let mergedItems = pricedItems;
      if (!catalogAvailable) {
        console.warn(
          "[Store Inventory Sync] Catálogo de precios no disponible — se conservan precios previos de la DB.",
        );
        mergedItems = pricedItems.map((item) => {
          const prev = existingByAsset.get(item.assetId);
          if (prev && prev.price > 0) {
            return { ...item, price: prev.price, name: prev.name || item.name };
          }
          return item;
        });
      }

      // Deduplicar por assetId
      const uniqueMap = new Map<string, any>();
      for (const item of mergedItems) {
        uniqueMap.set(item.assetId, item);
      }
      botItems = Array.from(uniqueMap.values());
    }

    // Protección: si no hay ítems y hay bots activos, no limpiar la DB
    if (botItems.length === 0 && activeBots.length > 0) {
      console.warn(`[Store Inventory Sync] Sin ítems de bots. Omitiendo sync para preservar datos actuales.`);
      return {
        itemsSynced: 0,
        activeBots: activeBots.length,
        skipped: true,
        message: 'No hay ítems de bots para guardar.',
      };
    }

    console.log(`[Store Inventory Sync] Guardando ${botItems.length} ítems de bots en la base de datos...`);
    await this.storeRepository.clearAndSaveMany(botItems);

    const countsBySteamId = new Map<string, number>();
    for (const item of botItems) {
      countsBySteamId.set(
        item.botSteamId,
        (countsBySteamId.get(item.botSteamId) ?? 0) + 1,
      );
    }
    await BotService.updateInventoryCounts(countsBySteamId);

    console.log(`[Store Inventory Sync] Sincronización completada.`);
    return {
      itemsSynced: botItems.length,
      activeBots: activeBots.length,
      skipped: false,
      message: `${botItems.length} ítems sincronizados con precios de mercado.`,
    };
  }

  private parseSteamInventory(
    data: any,
    botSteamId: string,
    inspectLinks: Map<string, string>,
  ): StoreItem[] {
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
        inspectLink: inspectLinks.get(String(asset.assetid)) ?? null,
        ...details,
        float: floatVal,
        pattern: patternVal,
        paintIndex: paintIndexVal,
      };
    });
  }
}
