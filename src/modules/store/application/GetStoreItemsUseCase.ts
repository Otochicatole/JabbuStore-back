import { StoreItem } from '../domain/Item';
import { storeAccounts } from '../../../storeAccounts';

export class GetStoreItemsUseCase {
  async execute(): Promise<StoreItem[]> {
    const appId = 730; // AppID de CS:GO / CS2
    const contextId = 2; // ContextID para inventario de skins

    // Realizar consultas en paralelo para todas las cuentas configuradas
    const fetchPromises = storeAccounts.map(async (steamId) => {
      const steamUrl = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=spanish&count=2000`;
      
      console.log(`[Store Inventory] Fetching inventory for bot: ${steamId}`);
      
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

    // Promise.allSettled asegura que si un bot falla (ej. rate limit), los demás sigan funcionando y mostrando ítems
    const results = await Promise.allSettled(fetchPromises);
    const aggregatedItems: StoreItem[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { steamId, data } = result.value;
        const parsedItems = this.parseSteamInventory(data, steamId);
        aggregatedItems.push(...parsedItems);
      } else {
        console.error(`[Store Inventory Error] Failed to fetch a bot inventory:`, result.reason);
      }
    }

    return aggregatedItems;
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
        name: description?.market_hash_name || description?.name,
        type: type,
        iconUrl: description?.icon_url
          ? `https://community.cloudflare.steamstatic.com/economy/image/${description.icon_url}`
          : null,
        tradable: description?.tradable === 1,
        marketable: description?.marketable === 1,
        botSteamId: botSteamId,
      };
    });
  }
}
