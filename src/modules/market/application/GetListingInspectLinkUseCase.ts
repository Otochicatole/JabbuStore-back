import { promises as fs } from 'node:fs';
import {
  buildInspectLinkFromCertificate,
  buildMaskedInspectLinkFromParams,
  isValidInspectLink,
} from '../../../shared/infrastructure/inspectLinkHelpers';
import {
  normalizeDopplerPhaseLabel,
  type DopplerPhaseLabel,
} from '../../pricing/domain/DopplerPhase';
import {
  assetMatchesListingBase,
  extractWearCode,
  isSouvenirName,
  isStatTrakName,
  phasesMatch,
  resolveDefIndexFromBaseName,
  resolvePaintIndexForPhase,
  stripWearFromMarketHashName,
  toSteamWebApiPhaseParam,
} from './floatSyncHelpers';
import { CATALOG_GLOBAL_JSON_PATH } from './GenerateCatalogGlobalUseCase';
import type {
  FloatAssetsQuery,
  SteamWebApiFloatAssetsClient,
} from '../infrastructure/SteamWebApiFloatAssetsClient';

export interface ListingInspectAssetsClient {
  fetchPage(query: FloatAssetsQuery): Promise<{ ok: boolean; assets: any[] }>;
}

interface CachedInspectLink {
  expiresAt: number;
  inspectLink: string | null;
}

interface CatalogPaintIndexLookup {
  mtimeMs: number;
  byBaseAndPhase: Map<string, number>;
  byBase: Map<string, number>;
}

const INSPECT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RATE_LIMIT_WAIT_MS = 1_500;
const UPSTREAM_REQUEST_TIMEOUT_MS = 4_000;

const WEAR_FLOAT_MAP: Record<string, number> = {
  fn: 0.035,
  mw: 0.075,
  ft: 0.26,
  ww: 0.415,
  bs: 0.72,
};

/** Exact CS2 weapon & glove def_index values keyed by normalized prefix before ' | '. */
const WEAPON_AND_GLOVE_DEF_INDEX: Record<string, number> = {
  'desert eagle': 1,
  'dual berettas': 2,
  'five-seven': 3,
  'glock-18': 4,
  'ak-47': 7,
  aug: 8,
  awp: 9,
  famas: 10,
  g3sg1: 11,
  'galil ar': 13,
  m249: 14,
  m4a4: 16,
  'mac-10': 17,
  p90: 19,
  'mp5-sd': 23,
  'ump-45': 24,
  xm1014: 25,
  'pp-bizon': 26,
  'mag-7': 27,
  negev: 28,
  'sawed-off': 29,
  'tec-9': 30,
  'zeus x27': 31,
  p2000: 32,
  mp7: 33,
  mp9: 34,
  nova: 35,
  p250: 36,
  'scar-20': 38,
  'sg 553': 39,
  'ssg 08': 40,
  'm4a1-s': 60,
  'usp-s': 61,
  'cz75-auto': 63,
  'r8 revolver': 64,
  'broken fang gloves': 4725,
  'bloodhound gloves': 5027,
  'sport gloves': 5030,
  'driver gloves': 5031,
  'hand wraps': 5032,
  'moto gloves': 5033,
  'specialist gloves': 5034,
  'hydra gloves': 5035,
};

let cachedCatalogLookup: CatalogPaintIndexLookup | null = null;
let inflightCatalogLoad: Promise<CatalogPaintIndexLookup | null> | null = null;

const TRAILING_WEAR_RE =
  /\s*(\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred|FN|MW|FT|WW|BS|Recién fabricado|Casi nuevo|Algo desgastado|Bastante desgastado|Deplorable)\))\s*$/i;

function parseListingInspectTarget(rawName: string): {
  baseMarketHashName: string;
  phase: DopplerPhaseLabel | null;
} {
  const separatorIndex = rawName.lastIndexOf(' | ');
  if (separatorIndex > 0) {
    const candidateSuffix = rawName.slice(separatorIndex + 3).trim();
    const detectedPhase = normalizeDopplerPhaseLabel(candidateSuffix);
    if (detectedPhase) {
      let base = rawName.slice(0, separatorIndex).trim();
      const trailingWearMatch = candidateSuffix.match(TRAILING_WEAR_RE);
      if (trailingWearMatch?.[1] && !TRAILING_WEAR_RE.test(base)) {
        base = `${base} ${trailingWearMatch[1]}`;
      }
      return {
        baseMarketHashName: base,
        phase: detectedPhase,
      };
    }
  }

  return {
    baseMarketHashName: rawName,
    phase: null,
  };
}

function cleanWeaponPrefix(baseMarketHashName: string): string {
  const withoutWear = stripWearFromMarketHashName(baseMarketHashName);
  const head = (withoutWear.split(' | ')[0] ?? withoutWear)
    .replace(/^★\s*/u, '')
    .replace(/^StatTrak™\s+/iu, '')
    .replace(/^StatTrak\s+/iu, '')
    .replace(/^Souvenir\s+/iu, '')
    .trim()
    .toLowerCase();
  return head;
}

export function resolveItemDefIndex(baseMarketHashName: string): number | null {
  const prefix = cleanWeaponPrefix(baseMarketHashName);
  if (prefix in WEAPON_AND_GLOVE_DEF_INDEX) {
    return WEAPON_AND_GLOVE_DEF_INDEX[prefix]!;
  }
  return resolveDefIndexFromBaseName(prefix) ?? resolveDefIndexFromBaseName(baseMarketHashName);
}

async function getCatalogPaintLookup(): Promise<CatalogPaintIndexLookup | null> {
  try {
    const stat = await fs.stat(CATALOG_GLOBAL_JSON_PATH);
    if (cachedCatalogLookup && cachedCatalogLookup.mtimeMs === stat.mtimeMs) {
      return cachedCatalogLookup;
    }

    if (!inflightCatalogLoad) {
      inflightCatalogLoad = (async () => {
        try {
          const raw = await fs.readFile(CATALOG_GLOBAL_JSON_PATH, 'utf-8');
          const parsed = JSON.parse(raw) as {
            items?: Array<{
              markethashname?: string;
              paintindex?: number;
              variantPhase?: string;
              variantPaintIndex?: number;
            }>;
          };
          const byBaseAndPhase = new Map<string, number>();
          const byBase = new Map<string, number>();
          const items = Array.isArray(parsed.items) ? parsed.items : [];

          for (const row of items) {
            const name = typeof row.markethashname === 'string' ? row.markethashname.trim() : '';
            if (!name) continue;
            if (typeof row.paintindex === 'number' && Number.isFinite(row.paintindex)) {
              if (!byBase.has(name)) {
                byBase.set(name, row.paintindex);
              }
            }
            if (
              typeof row.variantPhase === 'string' &&
              typeof row.variantPaintIndex === 'number' &&
              Number.isFinite(row.variantPaintIndex)
            ) {
              byBaseAndPhase.set(`${name} || ${row.variantPhase.trim().toLowerCase()}`, row.variantPaintIndex);
            }
          }

          cachedCatalogLookup = {
            mtimeMs: stat.mtimeMs,
            byBaseAndPhase,
            byBase,
          };
          return cachedCatalogLookup;
        } catch {
          return null;
        } finally {
          inflightCatalogLoad = null;
        }
      })();
    }

    return await inflightCatalogLoad;
  } catch {
    return null;
  }
}

async function resolvePaintIndexFromCatalog(
  baseMarketHashName: string,
  phase: string | null,
): Promise<number | null> {
  const lookup = await getCatalogPaintLookup();
  if (phase) {
    const fromCatalogVariant = lookup?.byBaseAndPhase.get(
      `${baseMarketHashName} || ${phase.toLowerCase()}`,
    );
    if (fromCatalogVariant !== undefined) {
      return fromCatalogVariant;
    }
    return resolvePaintIndexForPhase(phase, baseMarketHashName);
  }

  const fromCatalogBase = lookup?.byBase.get(baseMarketHashName);
  if (fromCatalogBase !== undefined) {
    return fromCatalogBase;
  }

  // Vanilla knives have no ' | ' skin separator and use paint_index = 0
  if (baseMarketHashName.includes('★') && !baseMarketHashName.includes(' | ')) {
    return 0;
  }

  return null;
}

/**
 * Resolves a real Steam inspect link (or synthesizes a clean CS2 masked certificate
 * when rate-limited/unavailable) without ever stalling on rate-limit queues.
 */
export class GetListingInspectLinkUseCase {
  private readonly cache = new Map<string, CachedInspectLink>();

  constructor(
    private readonly apiClient: ListingInspectAssetsClient | SteamWebApiFloatAssetsClient,
    private readonly cacheTtlMs = INSPECT_CACHE_TTL_MS,
  ) {}

  async execute(marketHashName: string): Promise<string | null> {
    const normalizedName = marketHashName.trim();
    if (!normalizedName) return null;

    const now = Date.now();
    const cached = this.cache.get(normalizedName);
    if (cached && cached.expiresAt > now) return cached.inspectLink;

    const { baseMarketHashName, phase } = parseListingInspectTarget(normalizedName);
    const wearCode = extractWearCode(baseMarketHashName);
    const isStatTrak = isStatTrakName(baseMarketHashName);
    const isSouvenir = isSouvenirName(baseMarketHashName);

    const defIndex = resolveItemDefIndex(baseMarketHashName);
    const paintIndex = await resolvePaintIndexFromCatalog(baseMarketHashName, phase);

    let inspectLink: string | null = null;
    try {
      const queries: FloatAssetsQuery[] = [];
      if (phase && defIndex != null && paintIndex != null) {
        // Query across global CS2 float/assets without restricting to source=youpin/only_market_id=1
        // because rare Doppler/Gamma/Emerald/Sapphire/Black Pearl phases often have 0 YouPin market_id rows
        // while having hundreds of real CS2 certificates indexed by def_index + paint_index.
        queries.push({
          defIndex,
          paintIndex,
          ...(wearCode ? { wear: wearCode } : {}),
          ...(isStatTrak ? { isStatTrak: true } : {}),
          ...(isSouvenir ? { isSouvenir: true } : {}),
          limit: 10,
          offset: 0,
          sort: 'newest',
          rateLimitPriority: 'normal',
          maxRateLimitWaitMs: MAX_RATE_LIMIT_WAIT_MS,
          requestTimeoutMs: UPSTREAM_REQUEST_TIMEOUT_MS,
        });
      } else {
        const apiPhase = phase ? toSteamWebApiPhaseParam(phase) : null;
        queries.push({
          source: 'youpin',
          marketHashName: baseMarketHashName,
          ...(apiPhase ? { phase: apiPhase } : {}),
          limit: 10,
          offset: 0,
          sort: 'newest',
          onlyMarketId: true,
          withItems: true,
          rateLimitPriority: 'normal',
          maxRateLimitWaitMs: MAX_RATE_LIMIT_WAIT_MS,
          requestTimeoutMs: UPSTREAM_REQUEST_TIMEOUT_MS,
        });
      }

      for (const query of queries) {
        const page = await Promise.race([
          this.apiClient.fetchPage(query),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Inspect upstream wall-clock timeout')),
              UPSTREAM_REQUEST_TIMEOUT_MS + 500,
            );
            timer.unref?.();
          }),
        ]);
        if (!page.ok) continue;

        for (const asset of page.assets) {
          const rawAssetName = String(
            asset?.markethashname ?? asset?.market_hash_name ?? '',
          ).trim();
          if (rawAssetName) {
            if (phase) {
              if (!assetMatchesListingBase(rawAssetName, baseMarketHashName)) continue;
            } else if (rawAssetName !== baseMarketHashName) {
              continue;
            }
          }

          if (phase) {
            const assetPaintIndex = Number(asset?.paintindex ?? asset?.paint_index);
            if (
              paintIndex != null &&
              Number.isFinite(assetPaintIndex) &&
              assetPaintIndex > 0 &&
              assetPaintIndex !== paintIndex
            ) {
              continue;
            }
            if (!phasesMatch(phase, asset?.phase)) continue;
          }

          const certificate = String(asset?.certificate ?? '').trim();
          if (!certificate) continue;

          const candidate = buildInspectLinkFromCertificate(certificate, {
            assetid: asset?.assetid ?? asset?.asset_id ?? asset?.id,
            steamid: asset?.steamid,
          });
          if (candidate && isValidInspectLink(candidate)) {
            inspectLink = candidate;
            break;
          }
        }

        if (inspectLink) break;
      }
    } catch (error) {
      console.warn(
        `[GetListingInspectLink] Upstream float/assets skipped for "${normalizedName}":`,
        error instanceof Error ? error.message : error,
      );
    }

    if (!inspectLink && defIndex != null && paintIndex != null) {
      const rawFloat = (wearCode ? WEAR_FLOAT_MAP[wearCode] : undefined) ?? 0.035;
      const floatValue = phase ? Math.min(0.078, Math.max(0.001, rawFloat)) : rawFloat;
      inspectLink = buildMaskedInspectLinkFromParams({
        defIndex,
        paintIndex,
        floatValue,
        rarity: baseMarketHashName.includes('★') ? 6 : 5,
        isStatTrak,
        isSouvenir,
      });
    }

    this.cache.set(normalizedName, {
      expiresAt: now + this.cacheTtlMs,
      inspectLink,
    });
    return inspectLink;
  }
}
