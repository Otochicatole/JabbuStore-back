import { StoreItem } from '../domain/Item';
import { IStoreRepository } from '../domain/IStoreRepository';
import { BotService } from '../../marketplace/application/BotService';
import { BotPriceSyncService } from '../../../modules/pricing';
import {
  SteamWebApiInventoryClient,
  normalizeParsedInventoryItem,
} from '../../../shared/infrastructure/SteamWebApiInventoryClient';

const botPriceSyncService = new BotPriceSyncService();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Espaciado conservador entre bots para respetar cuotas por minuto de /steam/api/inventory. */
const INVENTORY_API_GAP_MS = 31_000;
let lastInventoryApiCallAt = 0;

export class SyncStoreItemsUseCase {
  constructor(
    private storeRepository: IStoreRepository,
    private inventoryClient: SteamWebApiInventoryClient = new SteamWebApiInventoryClient(),
  ) {}

  private async waitForInventorySlot(): Promise<void> {
    const elapsed = Date.now() - lastInventoryApiCallAt;
    if (lastInventoryApiCallAt > 0 && elapsed < INVENTORY_API_GAP_MS) {
      await sleep(INVENTORY_API_GAP_MS - elapsed);
    }
    lastInventoryApiCallAt = Date.now();
  }

  async execute(): Promise<{
    itemsSynced: number;
    activeBots: number;
    skipped: boolean;
    message: string;
  }> {
    const bots = await BotService.getAllBots();
    const activeBots = bots.filter(bot => bot.isActive);

    const aggregatedItems: StoreItem[] = [];
    const failedBots: Array<{ steamId: string; reason: unknown }> = [];

    for (const bot of activeBots) {
      try {
        await this.waitForInventorySlot();
        console.log(`[Store Inventory Sync] Fetching bot inventory via SteamWebAPI: ${bot.steamId}`);
        const rawItems = await this.inventoryClient.fetchInventory({
          steamId: bot.steamId,
          game: 'cs2',
          noCache: true,
          state: 'active',
          withNoTradable: true,
        });

        for (const rawItem of rawItems) {
          const normalized = normalizeParsedInventoryItem(rawItem);
          if (!normalized) continue;
          aggregatedItems.push({
            assetId: normalized.assetId,
            classId: normalized.classId,
            name: normalized.name,
            type: normalized.type,
            iconUrl: normalized.iconUrl,
            tradable: normalized.tradable,
            marketable: normalized.marketable,
            botSteamId: bot.steamId,
            price: 0,
            inspectLink: normalized.inspectLink,
            rarity: normalized.rarity,
            exterior: normalized.exterior,
            category: normalized.category,
            isStatTrak: normalized.isStatTrak,
            isSouvenir: normalized.isSouvenir,
            float: normalized.float,
            pattern: normalized.pattern,
            paintIndex: normalized.paintIndex,
          });
        }
      } catch (reason) {
        failedBots.push({ steamId: bot.steamId, reason });
        console.error(
          `[Store Inventory Sync Error] Failed to fetch bot inventory (${bot.steamId}):`,
          reason,
        );
      }
    }

    if (failedBots.length > 0) {
      throw new Error(
        `Falló la descarga de ${failedBots.length}/${activeBots.length} inventario(s) de bots; se preservó la tienda anterior.`,
      );
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
}
