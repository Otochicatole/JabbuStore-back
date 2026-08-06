import { promises as fs } from 'fs';
import { CATALOG_GLOBAL_JSON_PATH, CatalogGlobalPayload, CatalogGlobalItemRow } from './GenerateCatalogGlobalUseCase';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';

export interface MarketCatalogItemInfo {
  name: string;
  price: number;
  iconUrl: string | null;
  rarity: string;
  exterior: string | null;
  category: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
  provider: string;
}

const DOPPLER_PHASE_SUFFIX = /\s*\|\s*(Phase [1-4]|Ruby|Sapphire|Black Pearl|Emerald)\s*$/i;

function stripDopplerPhase(name: string): string {
  return name.replace(DOPPLER_PHASE_SUFFIX, '').trim();
}

export class MarketCatalogService {
  private static cache: Map<string, MarketCatalogItemInfo> | null = null;
  private static lastMtimeMs = 0;

  static async getCatalogMap(): Promise<Map<string, MarketCatalogItemInfo>> {
    try {
      const stats = await fs.stat(CATALOG_GLOBAL_JSON_PATH);
      if (this.cache && stats.mtimeMs === this.lastMtimeMs) {
        return this.cache;
      }

      const raw = await fs.readFile(CATALOG_GLOBAL_JSON_PATH, 'utf-8');
      const payload: CatalogGlobalPayload = JSON.parse(raw);
      const newCache = new Map<string, MarketCatalogItemInfo>();

      if (Array.isArray(payload.items)) {
        for (const item of payload.items) {
          const baseName = item.markethashname ?? item.market_hash_name ?? item.marketname;
          if (!baseName || typeof baseName !== 'string') continue;

          const details = PriceEnrichmentService.inferDetailsFromMarketHashName(baseName);
          const iconUrl = this.getCatalogIconUrl(item);

          const info: MarketCatalogItemInfo = {
            name: baseName,
            price: item.youpinAsk ?? 0,
            iconUrl,
            rarity: details.rarity || 'common',
            exterior: details.exterior,
            category: details.category,
            isStatTrak: details.isStatTrak,
            isSouvenir: details.isSouvenir,
            provider: 'youpin',
          };

          newCache.set(baseName, info);

          const variantPhase = (item as any).variantPhase as string | undefined;
          if (variantPhase) {
            newCache.set(`${baseName} | ${variantPhase}`, {
              ...info,
              name: baseName,
              price: item.youpinAsk ?? 0,
            });
          }
        }
      }

      this.cache = newCache;
      this.lastMtimeMs = stats.mtimeMs;
      return this.cache;
    } catch (e) {
      console.warn('[MarketCatalogService] Error reading catalog-global.json:', e);
      return new Map();
    }
  }

  static async getListingByName(name: string): Promise<MarketCatalogItemInfo | null> {
    const map = await this.getCatalogMap();
    return map.get(name) ?? map.get(stripDopplerPhase(name)) ?? null;
  }

  private static getCatalogIconUrl(row: CatalogGlobalItemRow): string | null {
    const image = (row as any).variantImage || row.image || row.itemimage;
    if (!image) return null;
    if (typeof image === 'string' && /^https?:\/\//i.test(image)) return image;
    if (typeof image === 'string' && image.length > 0) {
      return `https://community.cloudflare.steamstatic.com/economy/image/${image}/360fx360f`;
    }
    return null;
  }
}
