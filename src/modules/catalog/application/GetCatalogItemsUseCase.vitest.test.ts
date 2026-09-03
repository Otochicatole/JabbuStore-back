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

  it('chooses fallback after checking the grouped representative against the price range', async () => {
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

    expect(grouped.items.map((item) => [item.name, item.price])).toEqual([['Redlino', 40]]);
    expect(grouped.pagination.total).toBe(1);
    expect(grouped.facets.categories).toEqual({ rifles: 3 });
    expect(ungrouped.items.map((item) => [item.name, item.price])).toEqual([['Redline', 50]]);
    expect(ungrouped.pagination.total).toBe(1);
    expect(ungrouped.facets.categories).toEqual({ rifles: 2 });
  });

  it('preserves grouped prices and complete variants without exposing internal search fields', async () => {
    seedCatalog([
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 50),
      fixture('AK-47 | Redline (Field-Tested)', 'rifle', 10),
      fixture('M4A4 | Redline (Field-Tested)', 'rifle', 15),
    ]);

    const result = await new GetCatalogItemsUseCase().execute(query(true, {
      search: 'redlien', maxPrice: 20, group: true,
    }));

    expect(result.items.map((item) => [item.weapon, item.price])).toEqual([
      ['M4A4', 15], ['AK-47', 10],
    ]);
    const group = result.items.find((item) => item.weapon === 'AK-47');
    expect(group?.variants?.map((item) => item.price)).toEqual([10, 50]);
    expect(result.pagination.total).toBe(2);
    expect(result.facets.categories).toEqual({ rifles: 3 });
    result.items.forEach(expectOnlyPublicFields);
  });
});
