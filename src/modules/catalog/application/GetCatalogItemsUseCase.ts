import { promises as fs } from 'fs';
import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { BotService } from '../../marketplace/application/BotService';
import { normalizeDopplerPhaseLabel, getDopplerPhaseLabelByPaintIndex } from '../../pricing/domain/DopplerPhase';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';
import type { CatalogGlobalPayload, CatalogGlobalItemRow } from '../../market/application/GenerateCatalogGlobalUseCase';
import { CATALOG_GLOBAL_JSON_PATH } from '../../market/application/GenerateCatalogGlobalUseCase';
import {
  classifyCatalogItem,
  type CatalogItemType,
} from '../domain/CatalogItemCapabilities';
import {
  createCatalogSearch,
  createCatalogSearchDocument,
  type CatalogSearchDocument,
} from '../domain/CatalogSearch';

type SortOption =
  | 'price_desc'
  | 'price_asc'
  | 'float_asc'
  | 'float_desc'
  | 'newest';

export interface CatalogItemsQuery {
  page: number;
  limit: number;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  categories: string[];
  conditions: string[];
  sort: SortOption;
  immediate: boolean;
  group: boolean;
}

export interface CatalogItem {
  id: string;
  name: string;
  weapon: string;
  rarity: string;
  price: number;
  imageUrl: string;
  float: number | null;
  pattern: number | null;
  exterior: string | null;
  category: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
  phase: string | null;
  isImmediate: boolean;
  inspectLink: string | null;
  provider: "bot" | "youpin";
  catalogItemType: CatalogItemType;
  supportsFloatStock: boolean;
  priceFilterEligible: boolean;
  variants?: CatalogItem[];
}

export interface CatalogItemsResult {
  items: CatalogItem[];
  facets: {
    categories: Record<string, number>;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface InternalCatalogItem extends CatalogItem {
  createdAt: Date;
  searchDocument: CatalogSearchDocument | null;
}

const DEFAULT_SORT: SortOption = 'price_desc';

const CONDITION_FLOAT_MAP: Record<string, [number, number]> = {
  factory_new: [0, 0.07],
  minimal_wear: [0.07, 0.15],
  field_tested: [0.15, 0.38],
  well_worn: [0.38, 0.45],
  battle_scarred: [0.45, 1.01],
};

const CATEGORY_ITEM_TYPES: Record<string, CatalogItemType[]> = {
  knives: ['knife'],
  gloves: ['gloves'],
  pistols: ['pistol'],
  smgs: ['smg'],
  rifles: ['rifle'],
  snipers: ['sniper_rifle'],
  shotguns: ['shotgun'],
  machine_guns: ['machinegun'],
  equipment: ['equipment'],
  agents: ['agent'],
  containers: ['container'],
  charms: ['charm'],
  graffiti: ['graffiti'],
  patches: ['patch'],
  music_kits: ['music_kit'],
  collectibles: ['collectible'],
  passes: ['pass'],
  keys: ['key'],
  gifts: ['gift'],
  tools: ['tool'],
  tags: ['tag'],
};

const CATEGORY_TOKEN_BY_ITEM_TYPE: Partial<Record<CatalogItemType, string>> = {
  knife: 'knives',
  gloves: 'gloves',
  pistol: 'pistols',
  smg: 'smgs',
  rifle: 'rifles',
  sniper_rifle: 'snipers',
  shotgun: 'shotguns',
  machinegun: 'machine_guns',
  equipment: 'equipment',
  agent: 'agents',
  container: 'containers',
  charm: 'charms',
  graffiti: 'graffiti',
  patch: 'patches',
  music_kit: 'music_kits',
  collectible: 'collectibles',
  pass: 'passes',
  key: 'keys',
  gift: 'gifts',
  tool: 'tools',
  tag: 'tags',
};

function applyModifier(basePrice: number, enabled: boolean, type: string, value: number): number {
  if (!enabled) return Math.round(basePrice * 100) / 100;

  let modifier = 0;
  switch (type) {
    case 'percentage_increase':
      modifier = (basePrice * value) / 100;
      break;
    case 'percentage_decrease':
      modifier = -((basePrice * value) / 100);
      break;
    case 'fixed_increase':
      modifier = value;
      break;
    case 'fixed_decrease':
      modifier = -value;
      break;
  }

  return Math.max(0, Math.round((basePrice + modifier) * 100) / 100);
}

function getCatalogIconUrl(row: CatalogGlobalItemRow): string | null {
  const image = row.image || row.itemimage;
  if (!image) return null;
  if (typeof image === 'string' && /^https?:\/\//i.test(image)) return image;
  if (typeof image === 'string' && image.length > 0) {
    return `https://community.cloudflare.steamstatic.com/economy/image/${image}/360fx360f`;
  }
  return null;
}

const WEAR_SUFFIX =
  /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred|FN|MW|FT|WW|BS|Recién fabricado|Casi nuevo|Algo desgastado|Bastante desgastado|Deplorable)\)\s*$/i;

function stripWearSuffix(value: string): string {
  return value.replace(WEAR_SUFFIX, '').trim();
}

function parseName(fullName: string): { weapon: string; name: string; phase: string | null } {
  if (!fullName.includes(' | ')) {
    return { weapon: 'Item', name: fullName, phase: null };
  }

  const parts = fullName.split(' | ');
  const weapon = parts[0] || 'Item';
  const name = stripWearSuffix(parts[1] || fullName);
  const phase = normalizeDopplerPhaseLabel(
    parts.length > 2 ? parts.slice(2).join(' | ') : null,
  );

  return { weapon, name, phase };
}

function exteriorMatchesCondition(exterior: string | null, condition: string): boolean {
  if (!exterior) return false;
  const ext = exterior.toLowerCase();

  switch (condition) {
    case 'factory_new':
      return ext.includes('factory') || ext.includes('fn') || ext.includes('recién');
    case 'minimal_wear':
      return ext.includes('minimal') || ext.includes('mw') || ext.includes('casi');
    case 'field_tested':
      return ext.includes('field') || ext.includes('ft') || ext.includes('algo');
    case 'well_worn':
      return ext.includes('well') || ext.includes('ww') || ext.includes('bastante');
    case 'battle_scarred':
      return ext.includes('battle') || ext.includes('bs') || ext.includes('deplorable');
    default:
      return false;
  }
}

function matchesConditions(item: InternalCatalogItem, conditions: string[]): boolean {
  if (conditions.length === 0) return true;

  return conditions.some((condition) => {
    if (item.float !== null) {
      const range = CONDITION_FLOAT_MAP[condition];
      if (!range) return false;
      return item.float >= range[0] && item.float < range[1];
    }

    return exteriorMatchesCondition(item.exterior, condition);
  });
}

function matchesCategories(item: InternalCatalogItem, categories: string[]): boolean {
  if (categories.length === 0) return true;

  return categories.some((category) => {
    return (CATEGORY_ITEM_TYPES[category] ?? []).includes(item.catalogItemType);
  });
}

function getNormalizedCondition(item: InternalCatalogItem): string {
  if (item.exterior) {
    const ext = item.exterior.toLowerCase().trim();
    if (ext.includes('recién') || ext.includes('factory') || ext.includes('fn')) return 'fn';
    if (ext.includes('casi') || ext.includes('minimal') || ext.includes('mw')) return 'mw';
    if (ext.includes('algo') || ext.includes('field') || ext.includes('ft')) return 'ft';
    if (ext.includes('bastante') || ext.includes('well') || ext.includes('ww')) return 'ww';
    if (ext.includes('deplorable') || ext.includes('battle') || ext.includes('bs')) return 'bs';
    return ext;
  }

  if (item.float === null) return 'fn';
  if (item.float < 0.07) return 'fn';
  if (item.float < 0.15) return 'mw';
  if (item.float < 0.38) return 'ft';
  if (item.float < 0.45) return 'ww';
  return 'bs';
}

function getGroupKey(item: InternalCatalogItem): string {
  if (!item.supportsFloatStock) {
    return [item.catalogItemType, item.id].join('|');
  }

  return [
    item.catalogItemType,
    item.weapon,
    item.name,
    getNormalizedCondition(item),
    item.isStatTrak ? 'st' : '',
    item.isSouvenir ? 'sv' : '',
    item.phase ?? '',
  ].join('|');
}

function sortItems(items: InternalCatalogItem[], sort: SortOption): InternalCatalogItem[] {
  const sorted = [...items];

  sorted.sort((a, b) => {
    switch (sort) {
      case 'price_asc':
        return a.price - b.price;
      case 'float_asc':
        if (a.float === null && b.float === null) return 0;
        if (a.float === null) return 1;
        if (b.float === null) return -1;
        return a.float - b.float;
      case 'float_desc':
        if (a.float === null && b.float === null) return 0;
        if (a.float === null) return 1;
        if (b.float === null) return -1;
        return b.float - a.float;
      case 'newest':
        return b.createdAt.getTime() - a.createdAt.getTime();
      case 'price_desc':
      default:
        return b.price - a.price;
    }
  });

  return sorted;
}

function stripInternal(item: InternalCatalogItem): CatalogItem {
  const { createdAt: _createdAt, searchDocument: _searchDocument, ...publicItem } = item;
  return publicItem;
}

const DOPPLER_STANDARD_PAINTS = new Set([415, 416, 417, 418, 419, 420, 421, 617, 618, 619, 849, 850, 851, 852, 853, 854, 855]);
const DOPPLER_GAMMA_PAINTS = new Set([568, 569, 570, 571, 572, 1119, 1120, 1121, 1122, 1123]);

const ALL_DOPPLER_PAINTS = new Set([...DOPPLER_STANDARD_PAINTS, ...DOPPLER_GAMMA_PAINTS]);

function resolveDopplerPhase(paintIndex: number | null | undefined): string | null {
  if (paintIndex == null || !Number.isFinite(paintIndex)) return null;
  if (!ALL_DOPPLER_PAINTS.has(paintIndex)) return null;
  return getDopplerPhaseLabelByPaintIndex(paintIndex);
}

export class GetCatalogItemsUseCase {
  async execute(query: CatalogItemsQuery): Promise<CatalogItemsResult> {
    await BotService.purgeStoreItemsForInactiveBots();

    const [settings, storeItems] = await Promise.all([
      prisma.adminSettings.findFirst(),
      prisma.storeItem.findMany({
        where: {
          tradable: true,
          marketable: true,
          price: { gt: 0 },
        },
      }),
    ]);

    const settingsData = settings ?? {
      globalPriceModifierEnabled: false,
      globalPriceModifierType: 'percentage_increase',
      globalPriceModifierValue: 0,
      marketModifierEnabled: false,
      marketModifierType: 'percentage_increase',
      marketModifierValue: 0,
    };

    const search = createCatalogSearch(query.search);

    const storeCatalogItems: InternalCatalogItem[] = !query.immediate
      ? []
      : storeItems.map((item) => {
          const parsed = parseName(item.name);
          const capabilities = classifyCatalogItem({
            itemgroup: item.type,
            category: item.category,
            name: item.name,
          });
          return {
            id: item.assetId,
            name: parsed.name,
            weapon: parsed.weapon,
            rarity: item.rarity,
            price: applyModifier(
              item.price,
              settingsData.globalPriceModifierEnabled,
              settingsData.globalPriceModifierType,
              settingsData.globalPriceModifierValue,
            ),
            imageUrl: item.iconUrl || '/skin.webp',
            float: item.float,
            pattern: item.pattern,
            exterior: item.exterior,
            category: item.category,
            isStatTrak: item.isStatTrak,
            isSouvenir: item.isSouvenir,
            phase: parsed.phase,
            isImmediate: true,
            inspectLink: item.inspectLink,
            provider: "bot" as const,
            catalogItemType: capabilities.itemType,
            supportsFloatStock: capabilities.supportsFloatStock,
            priceFilterEligible: capabilities.priceFilterEligible,
            createdAt: item.createdAt,
            searchDocument: search.isEmpty ? null : createCatalogSearchDocument({
              fullName: item.name,
              weapon: parsed.weapon,
              name: parsed.name,
              exterior: item.exterior,
              phase: parsed.phase,
            }),
          };
        });

    let marketCatalogItems: InternalCatalogItem[] = [];

    if (!query.immediate) {
      let catalogGlobalItems: InternalCatalogItem[] = [];
      try {
        const raw = await fs.readFile(CATALOG_GLOBAL_JSON_PATH, 'utf-8');
        const payload: CatalogGlobalPayload = JSON.parse(raw);

        if (Array.isArray(payload.items) && payload.items.length > 0) {
          catalogGlobalItems = payload.items.flatMap((item): InternalCatalogItem[] => {
            const name = item.markethashname ?? item.market_hash_name ?? item.marketname;
            if (!name || typeof name !== 'string') return [];

            const variantPhase = (item as any).variantPhase as string | undefined;
            const variantPaintIndex = (item as any).variantPaintIndex as number | undefined;
            const variantImage = (item as any).variantImage as string | undefined;

            const details = PriceEnrichmentService.inferDetailsFromMarketHashName(name);
            const capabilities = classifyCatalogItem({
              itemgroup: item.itemgroup,
              itemtype: item.itemtype,
              category: details.category,
              name,
            });
            const parsed = name.includes(' | ')
              ? parseName(name)
              : {
                  weapon: item.itemtype || capabilities.itemType,
                  name: item.itemname || name,
                  phase: null,
                };
            const paintIndex = variantPaintIndex ?? (item as any).paintindex;
            const dopplerPhase = resolveDopplerPhase(paintIndex);
            const phase = variantPhase ?? parsed.phase ?? dopplerPhase;

            const youpinAsk = item.youpinAsk ?? 0;
            const basePrice = youpinAsk;

            const price = applyModifier(
              basePrice,
              settingsData.marketModifierEnabled,
              settingsData.marketModifierType,
              settingsData.marketModifierValue,
            );
            const imageUrl = getCatalogIconUrl(item) || '/skin.webp';
            const displayImage = variantImage ? getCatalogIconUrl({ ...item, itemimage: variantImage, image: variantImage }) : imageUrl;

            const finalPhase = phase ?? parsed.phase;

            return [{
              id: finalPhase ? `${name} | ${finalPhase}` : name,
              name: parsed.name,
              weapon: parsed.weapon,
              rarity: details.rarity || 'common',
              price,
              imageUrl: displayImage || imageUrl,
              float: null,
              pattern: null,
              exterior: details.exterior,
              category: details.category,
              isStatTrak: details.isStatTrak,
              isSouvenir: details.isSouvenir,
              phase: finalPhase,
              isImmediate: false,
              inspectLink: null,
              provider: "youpin" as const,
              catalogItemType:
                capabilities.itemType,
              supportsFloatStock:
                typeof item.supportsFloatStock === 'boolean'
                  ? item.supportsFloatStock
                  : capabilities.supportsFloatStock,
              priceFilterEligible:
                typeof item.priceFilterEligible === 'boolean'
                  ? item.priceFilterEligible
                  : capabilities.priceFilterEligible,
              createdAt: new Date(),
              searchDocument: search.isEmpty ? null : createCatalogSearchDocument({
                fullName: name,
                weapon: parsed.weapon,
                name: parsed.name,
                exterior: details.exterior,
                phase: finalPhase,
              }),
            } satisfies InternalCatalogItem];
          });
        }
      } catch (e) {
        console.error('[GetCatalogItemsUseCase] Error leyendo catalog-global.json:', e);
      }

      marketCatalogItems = catalogGlobalItems;
    }

    const allCatalogItems = [...storeCatalogItems, ...marketCatalogItems];
    const conditionMatches = allCatalogItems.filter((item) =>
      matchesConditions(item, query.conditions),
    );

    const priceMatches = (item: InternalCatalogItem) => {
      if (!item.priceFilterEligible) return true;
      if (query.minPrice !== undefined && item.price < query.minPrice) return false;
      if (query.maxPrice !== undefined && item.price > query.maxPrice) return false;
      return true;
    };

    const filterCatalog = (fuzzy: boolean) => {
      const searchMatches = conditionMatches.filter((item) =>
        item.searchDocument === null || search.matches(item.searchDocument, fuzzy),
      );
      const categoryMatches = searchMatches.filter((item) =>
        matchesCategories(item, query.categories),
      );
      const items = (query.group ? this.groupItems(categoryMatches) : categoryMatches)
        .filter(priceMatches);

      return { searchMatches, items };
    };

    let filtered = filterCatalog(false);
    // Decide on the full filtered result, not the requested page. Both passes
    // use the same snapshot and preserve the existing group/price rules.
    if (filtered.items.length === 0 && search.canUseFuzzy) {
      filtered = filterCatalog(true);
    }

    const facetCounts: Record<string, number> = {};
    for (const item of filtered.searchMatches) {
      const categoryToken = CATEGORY_TOKEN_BY_ITEM_TYPE[item.catalogItemType];
      if (categoryToken) facetCounts[categoryToken] = (facetCounts[categoryToken] ?? 0) + 1;
    }

    const sorted = sortItems(filtered.items, query.sort || DEFAULT_SORT);
    const itemsForPagination = sorted.map(stripInternal);

    const total = itemsForPagination.length;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    const page = Math.min(Math.max(query.page, 1), totalPages);
    const start = (page - 1) * query.limit;
    const items = itemsForPagination.slice(start, start + query.limit);

    return {
      items,
      facets: {
        categories: facetCounts,
      },
      pagination: {
        page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  private groupItems(items: InternalCatalogItem[]): InternalCatalogItem[] {
    const groups = new Map<string, InternalCatalogItem[]>();

    for (const item of items) {
      const key = getGroupKey(item);
      const group = groups.get(key);
      if (group) {
        group.push(item);
      } else {
        groups.set(key, [item]);
      }
    }

    return Array.from(groups.values()).map((group) => {
      const variantsByLowestPrice = sortItems(group, 'price_asc');
      const representative = variantsByLowestPrice[0]!;
      if (variantsByLowestPrice.length < 2) return representative;

      return {
        ...representative,
        variants: variantsByLowestPrice.map(stripInternal),
      };
    });
  }
}
