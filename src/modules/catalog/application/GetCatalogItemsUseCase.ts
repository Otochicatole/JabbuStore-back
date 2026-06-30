import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { BotService } from '../../marketplace/application/BotService';

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
  variants?: CatalogItem[];
}

export interface CatalogItemsResult {
  items: CatalogItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface InternalCatalogItem extends CatalogItem {
  createdAt: Date;
}

const DEFAULT_SORT: SortOption = 'price_desc';

const CONDITION_FLOAT_MAP: Record<string, [number, number]> = {
  factory_new: [0, 0.07],
  minimal_wear: [0.07, 0.15],
  field_tested: [0.15, 0.38],
  well_worn: [0.38, 0.45],
  battle_scarred: [0.45, 1.01],
};

const CATEGORY_WEAPON_MAP: Record<string, string[]> = {
  knives: [
    'Karambit',
    'Bayonet',
    'Knife',
    'Navaja',
    'Stiletto',
    'Ursus',
    'Talon',
    'Huntsman',
    'Falchion',
    'Shadow',
    'Gut',
    'M9',
    'Flip',
    'Butterfly',
    'Skeleton',
    'Classic',
  ],
  gloves: ['Gloves', 'Wraps', 'Glove'],
  pistols: ['USP', 'Glock', 'P250', 'P2000', 'Desert Eagle', 'Five-SeveN', 'CZ75', 'Tec-9', 'Dual Berettas', 'R8', 'Deagle'],
  smgs: ['MP5', 'MP7', 'MP9', 'MAC-10', 'PP-Bizon', 'P90', 'UMP-45'],
  rifles: ['AK-47', 'M4A4', 'M4A1-S', 'FAMAS', 'Galil', 'AUG', 'SG 553'],
  snipers: ['AWP', 'SSG 08', 'SCAR-20', 'G3SG1'],
  shotguns: ['Nova', 'XM1014', 'MAG-7', 'Sawed-Off'],
  machine_guns: ['M249', 'Negev'],
  agents: ['Agent', 'Commander', 'Officer', 'Operator', 'Master'],
  containers: ['Case', 'Package', 'Capsule', 'Patch Pack', 'Graffiti Box', 'Souvenir'],
  music_kits: ['Music Kit'],
  patches: ['Patch'],
  stickers: ['Sticker'],
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

function parseName(fullName: string): { weapon: string; name: string; phase: string | null } {
  if (!fullName.includes(' | ')) {
    return { weapon: 'Item', name: fullName, phase: null };
  }

  const parts = fullName.split(' | ');
  const weapon = parts[0] || 'Item';
  let name = parts[1] || fullName;
  const phase = parts.length > 2 ? parts.slice(2).join(' | ') : null;

  if (name.includes(' (')) {
    name = name.split(' (')[0] || name;
  }

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
    const keywords = CATEGORY_WEAPON_MAP[category] ?? [];
    return keywords.some((keyword) =>
      item.weapon.toLowerCase().includes(keyword.toLowerCase()),
    );
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
  return [
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
  const { createdAt: _createdAt, ...publicItem } = item;
  return publicItem;
}

export class GetCatalogItemsUseCase {
  async execute(query: CatalogItemsQuery): Promise<CatalogItemsResult> {
    await BotService.purgeStoreItemsForInactiveBots();

    const [settings, storeItems, marketAssets] = await Promise.all([
      prisma.adminSettings.findFirst(),
      prisma.storeItem.findMany({
        where: {
          tradable: true,
          marketable: true,
          price: { gt: 0 },
        },
      }),
      prisma.floatItem.findMany({
        where: {
          available: true,
          price: { gt: 0 },
        },
        include: {
          resaleItem: true,
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

    const normalizedQuery = query.search?.trim().toLowerCase() ?? '';

    const storeCatalogItems: InternalCatalogItem[] = storeItems.map((item) => {
      const parsed = parseName(item.name);
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
        createdAt: item.createdAt,
      };
    });

    const marketCatalogItems: InternalCatalogItem[] = query.immediate
      ? []
      : marketAssets.map((asset) => {
          const parsed = parseName(asset.resaleItem.name);
          return {
            id: `youpin-${asset.id}`,
            name: parsed.name,
            weapon: parsed.weapon,
            rarity: asset.resaleItem.rarity,
            price: applyModifier(
              asset.price,
              settingsData.marketModifierEnabled,
              settingsData.marketModifierType,
              settingsData.marketModifierValue,
            ),
            imageUrl: asset.resaleItem.iconUrl || '/skin.webp',
            float: asset.floatValue,
            pattern: asset.paintSeed,
            exterior: asset.resaleItem.exterior,
            category: asset.resaleItem.category,
            isStatTrak: asset.resaleItem.isStatTrak,
            isSouvenir: asset.resaleItem.isSouvenir,
            phase: parsed.phase,
            isImmediate: false,
            inspectLink: asset.inspectLink,
            createdAt: asset.lastSyncAt,
          };
        });

    const filtered = [...storeCatalogItems, ...marketCatalogItems].filter((item) => {
      if (normalizedQuery) {
        const haystack = `${item.weapon} ${item.name} ${item.phase ?? ''}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }

      if (query.minPrice !== undefined && item.price < query.minPrice) return false;
      if (query.maxPrice !== undefined && item.price > query.maxPrice) return false;
      if (!matchesCategories(item, query.categories)) return false;
      if (!matchesConditions(item, query.conditions)) return false;

      return true;
    });

    const sorted = sortItems(filtered, query.sort || DEFAULT_SORT);
    const itemsForPagination = query.group
      ? this.groupItems(sorted)
      : sorted.map(stripInternal);

    const total = itemsForPagination.length;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    const page = Math.min(Math.max(query.page, 1), totalPages);
    const start = (page - 1) * query.limit;
    const items = itemsForPagination.slice(start, start + query.limit);

    return {
      items,
      pagination: {
        page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  private groupItems(items: InternalCatalogItem[]): CatalogItem[] {
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
      const representative = stripInternal(group[0]!);
      if (group.length < 2) return representative;

      return {
        ...representative,
        variants: group.map(stripInternal),
      };
    });
  }
}
