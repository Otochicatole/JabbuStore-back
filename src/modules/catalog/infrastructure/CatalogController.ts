import { Request, Response } from 'express';
import {
  CatalogItemsQuery,
  GetCatalogItemsUseCase,
} from '../application/GetCatalogItemsUseCase';

const SORT_OPTIONS = new Set([
  'price_desc',
  'price_asc',
  'float_asc',
  'float_desc',
  'newest',
]);

const LEGACY_SORT_MAP: Record<string, CatalogItemsQuery['sort']> = {
  'Precio: Mayor a Menor': 'price_desc',
  'Precio: Menor a Mayor': 'price_asc',
  'Float: Menor a Mayor': 'float_asc',
  'Float: Mayor a Menor': 'float_desc',
  'Más recientes': 'newest',
};

const LEGACY_CATEGORY_MAP: Record<string, string> = {
  Cuchillos: 'knives',
  Guantes: 'gloves',
  Pistolas: 'pistols',
  Subfusiles: 'smgs',
  'Rifles de asalto': 'rifles',
  'Rifles de francotirador': 'snipers',
  Escopetas: 'shotguns',
  Ametralladoras: 'machine_guns',
  Agentes: 'agents',
  Contenedores: 'containers',
  'Kits musicales': 'music_kits',
  Parches: 'patches',
  Pegatinas: 'stickers',
};

const LEGACY_CONDITION_MAP: Record<string, string> = {
  'Recién fabricado': 'factory_new',
  'Casi nuevo': 'minimal_wear',
  'Algo desgastado': 'field_tested',
  'Bastante desgastado': 'well_worn',
  Deplorable: 'battle_scarred',
};

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeList(value: unknown, legacyMap: Record<string, string>): string[] {
  return parseList(value).map((entry) => legacyMap[entry] ?? entry);
}

function parseSort(value: unknown): CatalogItemsQuery['sort'] {
  const raw = String(value ?? 'price_desc');
  if (SORT_OPTIONS.has(raw)) return raw as CatalogItemsQuery['sort'];
  return LEGACY_SORT_MAP[raw] ?? 'price_desc';
}

function parseBoolean(primary: unknown, fallback?: unknown): boolean {
  const value = primary ?? fallback;
  return value === '1' || value === 'true';
}

function parseCatalogQuery(req: Request): CatalogItemsQuery {
  const parsed: CatalogItemsQuery = {
    page: parsePositiveInt(req.query.page, 1, 100000),
    limit: parsePositiveInt(req.query.limit, 40, 100),
    categories: normalizeList(req.query.categories ?? req.query.cat, LEGACY_CATEGORY_MAP),
    conditions: normalizeList(req.query.conditions ?? req.query.cond, LEGACY_CONDITION_MAP),
    sort: parseSort(req.query.sort),
    immediate: parseBoolean(req.query.immediate, req.query.instant),
    group: req.query.group === '1' || req.query.group === 'true',
  };

  const search = String(req.query.search ?? req.query.q ?? '').trim();
  if (search) parsed.search = search;

  const min = parseNumber(req.query.minPrice ?? req.query.min);
  if (min !== undefined) parsed.minPrice = min;

  const max = parseNumber(req.query.maxPrice ?? req.query.max);
  if (max !== undefined) parsed.maxPrice = max;

  return parsed;
}

export class CatalogController {
  constructor(private getCatalogItemsUseCase = new GetCatalogItemsUseCase()) {}

  async getItems(req: Request, res: Response): Promise<void> {
    try {
      const result = await this.getCatalogItemsUseCase.execute(parseCatalogQuery(req));
      res.json(result);
    } catch (error: any) {
      console.error('[CatalogController Error] Failed to get catalog items:', error);
      res.status(500).json({
        error: error?.message || 'Failed to retrieve catalog items.',
      });
    }
  }
}
