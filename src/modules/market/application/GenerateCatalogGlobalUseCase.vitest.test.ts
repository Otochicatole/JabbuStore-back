import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SteamWebApiItemsCatalogRow } from '../../pricing/domain/types';
import { GenerateCatalogGlobalUseCase, type CatalogFilters } from './GenerateCatalogGlobalUseCase';

const temporaryDirectories: string[] = [];

function row(
  marketHashName: string,
  itemgroup: string,
  price: number,
  extra: Partial<SteamWebApiItemsCatalogRow> = {},
): SteamWebApiItemsCatalogRow {
  return {
    markethashname: marketHashName,
    marketname: marketHashName,
    itemgroup,
    pricesafe: price,
    pricereal: price,
    ...extra,
  };
}

function allFilters(overrides: Partial<CatalogFilters> = {}): CatalogFilters {
  return {
    catalogFilterKnivesEnabled: true,
    catalogFilterGlovesEnabled: true,
    catalogFilterRiflesEnabled: true,
    catalogFilterPistolsEnabled: true,
    catalogFilterSMGsEnabled: true,
    catalogFilterHeavyEnabled: true,
    catalogFilterEquipmentEnabled: true,
    catalogFilterStickersEnabled: true,
    catalogFilterContainersEnabled: true,
    catalogFilterAgentsEnabled: true,
    catalogFilterCharmsEnabled: true,
    catalogFilterGraffitiEnabled: true,
    catalogFilterPatchesEnabled: true,
    catalogFilterMusicKitsEnabled: true,
    catalogFilterCollectiblesEnabled: true,
    catalogFilterPassesEnabled: true,
    catalogFilterKeysEnabled: true,
    catalogFilterGiftsEnabled: true,
    catalogFilterToolsEnabled: true,
    catalogFilterTagsEnabled: true,
    catalogFilterSouvenirEnabled: true,
    catalogFilterStatTrakEnabled: true,
    catalogMinPrice: 0,
    ...overrides,
  };
}

async function generate(items: SteamWebApiItemsCatalogRow[], filters: CatalogFilters) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jabbustore-catalog-'));
  temporaryDirectories.push(directory);
  const outputPath = path.join(directory, 'catalog-global.json');
  const useCase = new GenerateCatalogGlobalUseCase(
    { readCatalog: async () => ({
      fetchedAt: '2026-08-25T00:00:00.000Z',
      currency: 'USD',
      market: 'youpin',
      sourceUrl: 'test://items-catalog',
      pageCount: 1,
      itemCount: items.length,
      errors: [],
      items,
    }) },
    outputPath,
  );

  await useCase.execute(filters);
  return JSON.parse(await fs.readFile(outputPath, 'utf8')) as {
    items: Array<{ markethashname: string; catalogItemType: string; priceFilterEligible: boolean }>;
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('GenerateCatalogGlobalUseCase', () => {
  it('includes every enabled canonical item type and fails closed for unknown groups', async () => {
    const items = [
      row('AK-47 | Redline (Factory New)', 'rifle', 20),
      row('Sticker | Test', 'sticker', 1),
      row('Spectrum 2 Case', 'container', 1),
      row('Lt. Commander Ricksaw', 'agent', 1),
      row('Charm | Test', 'charm', 1),
      row('Unknown | Test', 'unknown', 1),
    ];

    const payload = await generate(items, allFilters());

    expect(payload.items.map((item) => item.catalogItemType)).toEqual([
      'rifle',
      'sticker',
      'container',
      'agent',
      'charm',
    ]);
  });

  it('applies the minimum price only to weapons and knives', async () => {
    const payload = await generate([
      row('AK-47 | Cheap', 'rifle', 1),
      row('★ Karambit | Cheap', 'knife', 1),
      row('Sticker | Cheap', 'sticker', 1),
      row('Gamma Case', 'container', 1),
      row('Agent | Cheap', 'agent', 1),
      row('Gloves | Cheap', 'gloves', 1),
      row('Zeus X27 | Cheap', 'equipment', 1, { itemtype: 'Zeus X27' }),
    ], allFilters({ catalogMinPrice: 10 }));

    expect(payload.items.map((item) => item.catalogItemType)).toEqual([
      'sticker',
      'container',
      'agent',
      'gloves',
    ]);
  });

  it('removes a disabled non-weapon type without affecting other types', async () => {
    const payload = await generate([
      row('Sticker | Disabled', 'sticker', 5),
      row('Gamma Case', 'container', 5),
    ], allFilters({ catalogFilterStickersEnabled: false }));

    expect(payload.items.map((item) => item.catalogItemType)).toEqual(['container']);
  });
});
