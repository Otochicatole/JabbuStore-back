import type { StoreItem } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogGlobalItemRow } from '../../market/application/GenerateCatalogGlobalUseCase';
import {
  GetCatalogItemsUseCase,
  type CatalogItem,
  type CatalogItemsQuery,
} from './GetCatalogItemsUseCase';

const mocks = vi.hoisted(() => ({
  findSettings: vi.fn(),
  findStoreItems: vi.fn(),
  purgeInactiveBots: vi.fn(),
  readCatalog: vi.fn(),
}));

vi.mock('../../../shared/infrastructure/PrismaClient', () => ({
  prisma: {
    adminSettings: { findFirst: mocks.findSettings },
    storeItem: { findMany: mocks.findStoreItems },
  },
}));

vi.mock('../../marketplace/application/BotService', () => ({
  BotService: { purgeStoreItemsForInactiveBots: mocks.purgeInactiveBots },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: { ...actual.promises, readFile: mocks.readCatalog },
  };
});

type FixtureType = 'rifle' | 'pistol' | 'knife' | 'shotgun' | 'sticker' | 'container';

interface ItemFixture {
  name: string;
  type: FixtureType;
  price: number;
  float: number | null;
  exterior: string | null;
  phase?: string;
}

function fixture(
  name: string,
  type: FixtureType = 'rifle',
  price = 20,
  extra: Partial<ItemFixture> = {},
): ItemFixture {
  return { name, type, price, float: 0.2, exterior: 'Field-Tested', ...extra };
}

function seedCatalog(items: ItemFixture[]) {
  const storeItems: StoreItem[] = items.map((item, index) => ({
    assetId: `bot-${index}`,
    classId: `class-${index}`,
    name: item.phase ? `${item.name} | ${item.phase}` : item.name,
    type: item.type,
    iconUrl: null,
    tradable: true,
    marketable: true,
    botSteamId: 'test-bot',
    price: item.price,
    isPriceManual: false,
    rarity: 'common',
    exterior: item.exterior,
    category: item.type,
    isStatTrak: item.name.includes('StatTrak'),
    isSouvenir: item.name.includes('Souvenir'),
    float: item.float,
    pattern: null,
    paintIndex: null,
    inspectLink: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  }));
  const catalogItems: CatalogGlobalItemRow[] = items.map((item) => ({
    markethashname: item.name,
    marketname: item.name,
    itemgroup: item.type,
    youpinAsk: item.price,
    youpinVolume: null,
    catalogItemType: item.type,
    supportsFloatStock: item.type !== 'sticker' && item.type !== 'container',
    priceFilterEligible: item.type !== 'sticker' && item.type !== 'container',
    ...(item.phase ? { variantPhase: item.phase } : {}),
  }));

  mocks.findStoreItems.mockResolvedValue(storeItems);
  mocks.readCatalog.mockResolvedValue(JSON.stringify({ items: catalogItems }));
}

function query(immediate: boolean, overrides: Partial<CatalogItemsQuery> = {}): CatalogItemsQuery {
  return {
    page: 1,
    limit: 40,
    categories: [],
    conditions: [],
    sort: 'price_desc',
    immediate,
    group: true,
    ...overrides,
  };
}

const publicFields = [
  'id', 'name', 'weapon', 'rarity', 'price', 'imageUrl', 'float', 'pattern',
  'exterior', 'category', 'isStatTrak', 'isSouvenir', 'phase', 'isImmediate',
  'inspectLink', 'provider', 'catalogItemType', 'supportsFloatStock', 'priceFilterEligible',
].sort();

function expectOnlyPublicFields(item: CatalogItem) {
  const { variants, ...fields } = item;
  expect(Object.keys(fields).sort()).toEqual(publicFields);
  variants?.forEach(expectOnlyPublicFields);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findSettings.mockResolvedValue(null);
  mocks.purgeInactiveBots.mockResolvedValue(undefined);
  seedCatalog([]);
});

describe.each([
  { provider: 'bot', immediate: true },
  { provider: 'youpin', immediate: false },
] as const)('GetCatalogItemsUseCase search ($provider)', ({ provider, immediate }) => {
  it('treats empty and symbol-only searches as an unfiltered catalog', async () => {
    seedCatalog([
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 50),
      fixture('M4A4 | Asiimov (Field-Tested)', 'rifle', 20),
    ]);
    const useCase = new GetCatalogItemsUseCase();
    const baseline = await useCase.execute(query(immediate));

    for (const search of ['', '  () | -_\\ ★ ™  ']) {
      const result = await useCase.execute(query(immediate, { search }));
      expect(result).toEqual(baseline);
      expect(result.pagination.total).toBe(2);
      result.items.forEach(expectOnlyPublicFields);
    }
  });

  it.each([
    'ak47 redline',
    'redline ak 47',
    'REDLINE_ak47',
    '\\redline | (AK47)',
    'fieldtested redline ak47',
    'StatTrak™ AK-47 | Redline (Field-Tested)',
  ])('finds a decorated name with query %s', async (search) => {
    seedCatalog([
      fixture('StatTrak™ AK-47 | Redline (Field-Tested)'),
      fixture('M4A4 | Asiimov (Field-Tested)'),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, { search }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: 'Redline', weapon: 'StatTrak™ AK-47', provider, isImmediate: immediate,
    });
    expect(result.pagination.total).toBe(1);
    result.items.forEach(expectOnlyPublicFields);
  });

  it('searches the original sticker event after the third separator', async () => {
    seedCatalog([
      fixture('Sticker | FaZe Clan (Holo) | Antwerp 2022', 'sticker'),
      fixture('Sticker | FaZe Clan (Holo) | Paris 2023', 'sticker'),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, {
      search: '2022 antwerp faze holo',
    }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'FaZe Clan (Holo)', provider });
    expect(result.pagination.total).toBe(1);
    result.items.forEach(expectOnlyPublicFields);
  });

  it('searches Doppler phases without confusing numeric values', async () => {
    seedCatalog([
      fixture('★ Karambit | Doppler (Factory New)', 'knife', 100, { phase: 'Phase 1' }),
      fixture('★ Karambit | Doppler (Factory New)', 'knife', 200, { phase: 'Phase 2' }),
      fixture('★ Karambit | Doppler (Factory New)', 'knife', 300, { phase: 'Phase 3' }),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, {
      search: 'phase 2 doppler',
    }));
    const missing = await new GetCatalogItemsUseCase().execute(query(immediate, {
      search: 'phase 4 doppler',
    }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ phase: 'Phase 2', price: 200, provider });
    expect(missing.items).toEqual([]);
    expect(missing.pagination.total).toBe(0);
  });

  it('uses a one-letter transposition when there are no normalized matches', async () => {
    seedCatalog([
      fixture('AK-47 | Redline (Field-Tested)'),
      fixture('M4A4 | Asiimov (Field-Tested)'),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, {
      search: 'redlien ak47',
    }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Redline', weapon: 'AK-47', provider });
    expect(mocks.findStoreItems).toHaveBeenCalledTimes(1);
    expect(mocks.findSettings).toHaveBeenCalledTimes(1);
    expect(mocks.purgeInactiveBots).toHaveBeenCalledTimes(1);
    expect(mocks.readCatalog).toHaveBeenCalledTimes(immediate ? 0 : 1);
  });

  it.each([
    { search: 'fade', exact: '★ Karambit | Fade (Factory New)', type: 'knife' as const,
      approximate: 'Sticker | FaZe Clan (Holo) | Antwerp 2022', name: 'Fade' },
    { search: 'case', exact: 'Danger Zone Case', type: 'container' as const,
      approximate: 'Sticker | Cash', name: 'Danger Zone Case' },
  ])('keeps exact $search matches without adding similar names', async ({ search, exact, type, approximate, name }) => {
    seedCatalog([fixture(exact, type), fixture(approximate, 'sticker')]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, { search }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name, provider });
    expect(result.pagination.total).toBe(1);
  });

  it('allows typo fallback after category filtering removes all normalized matches', async () => {
    seedCatalog([
      fixture('Sticker | FaZe Clan (Holo) | Antwerp 2022', 'sticker'),
      fixture('★ Karambit | Fade (Factory New)', 'knife'),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, {
      search: 'faze', categories: ['knives'],
    }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Fade', provider });
  });

  it('allows typo fallback after condition filtering removes all normalized matches', async () => {
    seedCatalog([
      fixture('AK-47 | Redline (Factory New)', 'rifle', 100, { float: 0.01, exterior: 'Factory New' }),
      fixture('M4A4 | Redlino (Field-Tested)'),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, {
      search: 'redline', conditions: ['field_tested'],
    }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Redlino', provider });
    expect(result.facets.categories).toEqual({ rifles: 1 });
  });

  it('allows typo fallback after price filtering removes all normalized matches', async () => {
    seedCatalog([
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 100),
      fixture('M4A4 | Redlino (Field-Tested)', 'rifle', 20),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, {
      search: 'redline', maxPrice: 50,
    }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Redlino', price: 20, provider });
    expect(result.facets.categories).toEqual({ rifles: 2 });
  });

  it.each(['redline', 'redlien'])('uses the selected search mode for facets without applying category or price (%s)', async (search) => {
    seedCatalog([
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 100),
      fixture('M4A4 | Redline (Field-Tested)', 'rifle', 200),
      fixture('Glock-18 | Redline (Field-Tested)', 'pistol', 10),
      fixture('★ Karambit | Redline (Factory New)', 'knife', 20, { float: 0.01, exterior: 'Factory New' }),
      fixture('Nova | Dragon (Field-Tested)', 'shotgun', 30),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, {
      search, categories: ['rifles'], conditions: ['field_tested'], maxPrice: 150,
    }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Redline', weapon: 'AK-47', price: 100, provider });
    expect(result.facets.categories).toEqual({ rifles: 2, pistols: 1 });
  });

  it('clamps an out-of-range page without enabling typo fallback', async () => {
    seedCatalog([
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 100),
      fixture('Glock-18 | Redline (Field-Tested)', 'pistol', 20),
      fixture('Nova | Redlino (Field-Tested)', 'shotgun', 50),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(immediate, {
      search: 'redline', page: 99, limit: 1,
    }));

    expect(result.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Redline', weapon: 'Glock-18', provider });
    expect(result.facets.categories).toEqual({ rifles: 1, pistols: 1 });
  });
});

describe('GetCatalogItemsUseCase search with bot variants', () => {
  it.each([
    { sort: 'price_asc' as const, ids: ['bot-0', 'bot-1'] },
    { sort: 'float_asc' as const, ids: ['bot-1', 'bot-0'] },
    { sort: 'float_desc' as const, ids: ['bot-0', 'bot-1'] },
  ])('respects $sort when matching approximate names', async ({ sort, ids }) => {
    seedCatalog([
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 20, { float: 0.3 }),
      fixture('M4A4 | Redline (Factory New)', 'rifle', 100, { float: 0.05 }),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(true, {
      search: 'redlien', sort, group: false,
    }));

    expect(result.items.map((item) => item.id)).toEqual(ids);
  });

  it('includes the stored exterior even when it is absent from the original name', async () => {
    seedCatalog([fixture('AK-47 | Redline', 'rifle', 20)]);

    const result = await new GetCatalogItemsUseCase().execute(query(true, {
      search: 'field tested redline', conditions: ['field_tested'],
    }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Redline', exterior: 'Field-Tested' });
  });

  it('retains in-range variants when grouping and only falls back when no variants match the price range', async () => {
    seedCatalog([
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 10),
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 50),
      fixture('M4A4 | Redlino (Field-Tested)', 'rifle', 40),
    ]);

    const grouped = await new GetCatalogItemsUseCase().execute(query(true, {
      search: 'redline', minPrice: 30, group: true,
    }));
    const ungrouped = await new GetCatalogItemsUseCase().execute(query(true, {
      search: 'redline', minPrice: 30, group: false,
    }));

    // The $50 variant matches minPrice 30, so Redline is returned in both modes
    expect(grouped.items.map((item) => [item.name, item.price])).toEqual([['Redline', 50]]);
    expect(grouped.pagination.total).toBe(1);
    expect(ungrouped.items.map((item) => [item.name, item.price])).toEqual([['Redline', 50]]);
    expect(ungrouped.pagination.total).toBe(1);

    // If minPrice excludes all variants (e.g. minPrice: 60), it falls back to typo match
    const fallbackResult = await new GetCatalogItemsUseCase().execute(query(true, {
      search: 'redline', minPrice: 35, maxPrice: 45, group: true,
    }));
    expect(fallbackResult.items.map((item) => [item.name, item.price])).toEqual([['Redlino', 40]]);
  });

  it('preserves grouped prices and variants within the price range without exposing internal search fields', async () => {
    seedCatalog([
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 50),
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 10),
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 18),
      fixture('M4A4 | Redline (Field-Tested)', 'rifle', 15),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(true, {
      search: 'redlien', maxPrice: 20, group: true,
    }));

    expect(result.items.map((item) => [item.weapon, item.price])).toEqual([
      ['M4A4', 15], ['AK-47', 10],
    ]);
    const group = result.items.find((item) => item.weapon === 'AK-47');
    // Only variants matching maxPrice (10 and 18, excluding 50) are retained
    expect(group?.variants?.map((item) => item.price)).toEqual([10, 18]);
    expect(result.pagination.total).toBe(2);
    expect(result.facets.categories).toEqual({ rifles: 4 });
    result.items.forEach(expectOnlyPublicFields);
  });

  it.each([
    { provider: 'bot', immediate: true },
    { provider: 'youpin', immediate: false },
  ] as const)('applies price filtering to non-weapon items like stickers, containers, and agents ($provider)', async ({ provider, immediate }) => {
    seedCatalog([
      fixture('Sticker | Cheap', 'sticker', 2),
      fixture('Sticker | Expensive', 'sticker', 80),
      fixture('Clutch Case', 'container', 1.5),
      fixture('Weapon Case', 'container', 95),
      fixture('AK-47 | Slate (Field-Tested)', 'rifle', 30),
    ]);

    const useCase = new GetCatalogItemsUseCase();

    // Filter between $10 and $50
    const inRange = await useCase.execute(query(immediate, {
      minPrice: 10,
      maxPrice: 50,
      group: false,
    }));

    expect(inRange.items.map((item) => item.name)).toEqual(['Slate']);
    expect(inRange.items.every((item) => item.price >= 10 && item.price <= 50)).toBe(true);

    // Filter stickers under $10
    const cheapStickers = await useCase.execute(query(immediate, {
      categories: ['stickers'],
      maxPrice: 10,
      group: false,
    }));

    expect(cheapStickers.items.map((item) => item.name)).toEqual(['Cheap']);
    expect(cheapStickers.items[0]?.price).toBe(2);

    // Filter containers over $50
    const expensiveCases = await useCase.execute(query(immediate, {
      categories: ['containers'],
      minPrice: 50,
      group: false,
    }));

    expect(expensiveCases.items.map((item) => item.name)).toEqual(['Weapon Case']);
    expect(expensiveCases.items[0]?.price).toBe(95);
  });

  it.each([
    { provider: 'bot', immediate: true },
    { provider: 'youpin', immediate: false },
  ] as const)('applies admin settings catalogMinPrice in $provider catalog', async ({ provider, immediate }) => {
    mocks.findSettings.mockResolvedValue({
      catalogMinPrice: 15,
      globalPriceModifierEnabled: false,
      marketModifierEnabled: false,
    });

    seedCatalog([
      fixture('AK-47 | Safari Mesh (Field-Tested)', 'rifle', 5),
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 25),
      fixture('★ Karambit | Lore (Field-Tested)', 'knife', 400),
      fixture('Sticker | Cheap', 'sticker', 2),
      fixture('Danger Zone Case', 'container', 3),
    ]);

    const useCase = new GetCatalogItemsUseCase();
    const result = await useCase.execute(query(immediate, { group: false }));

    // Weapons below $15 are filtered out; weapons >= $15 and non-weapon commodities are preserved
    const names = result.items.map((item) => item.name);
    expect(names).toContain('Redline');
    expect(names).toContain('Lore');
    expect(names).toContain('Cheap');
    expect(names).toContain('Danger Zone Case');
    expect(names).not.toContain('Safari Mesh');
    expect(result.items.find((item) => item.name === 'Safari Mesh')).toBeUndefined();
  });
});

