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

const INSPECT_CACHE_TTL_MS = 10 * 60 * 1000;

const WEAR_FLOAT_MAP: Record<string, number> = {
  fn: 0.035,
  mw: 0.075,
  ft: 0.26,
  ww: 0.415,
  bs: 0.72,
};

function parseListingInspectTarget(rawName: string): {
  baseMarketHashName: string;
  phase: DopplerPhaseLabel | null;
} {
  const separatorIndex = rawName.lastIndexOf(' | ');
  if (separatorIndex > 0) {
    const candidateSuffix = rawName.slice(separatorIndex + 3).trim();
    const detectedPhase = normalizeDopplerPhaseLabel(candidateSuffix);
    if (detectedPhase) {
      return {
        baseMarketHashName: rawName.slice(0, separatorIndex).trim(),
        phase: detectedPhase,
      };
    }
  }

  return {
    baseMarketHashName: rawName,
    phase: null,
  };
}

function resolveItemDefIndex(baseMarketHashName: string): number | null {
  if (baseMarketHashName.toLowerCase().includes('glock-18')) {
    return 4;
  }
  return resolveDefIndexFromBaseName(baseMarketHashName);
}

async function resolvePaintIndexFromCatalog(
  baseMarketHashName: string,
  phase: string,
): Promise<number | null> {
  try {
    const raw = await fs.readFile(CATALOG_GLOBAL_JSON_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as {
      items?: Array<{
        markethashname?: string;
        variantPhase?: string;
        variantPaintIndex?: number;
      }>;
    };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const expectedPhase = phase.toLowerCase();
    for (const row of items) {
      if (
        row.markethashname === baseMarketHashName &&
        typeof row.variantPhase === 'string' &&
        row.variantPhase.toLowerCase() === expectedPhase &&
        typeof row.variantPaintIndex === 'number' &&
        Number.isFinite(row.variantPaintIndex)
      ) {
        return row.variantPaintIndex;
      }
    }
  } catch {
    // Fallback to static table when catalog-global.json is unavailable (e.g. unit tests)
  }
  return resolvePaintIndexForPhase(phase, baseMarketHashName);
}

/** Resolves a real Steam inspect link (or clean Doppler/Gamma phase certificate) without exposing SteamWebAPI credentials. */
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

    const defIndex = phase ? resolveItemDefIndex(baseMarketHashName) : null;
    const paintIndex = phase
      ? await resolvePaintIndexFromCatalog(baseMarketHashName, phase)
      : null;

    let inspectLink: string | null = null;
    try {
      const queries: FloatAssetsQuery[] = [];
      if (phase && defIndex != null && paintIndex != null) {
        queries.push({
          source: 'youpin',
          defIndex,
          paintIndex,
          ...(wearCode ? { wear: wearCode } : {}),
          isStatTrak,
          isSouvenir,
          limit: 10,
          offset: 0,
          sort: 'newest',
          onlyMarketId: true,
          withItems: true,
          rateLimitPriority: 'normal',
          requestTimeoutMs: 10_000,
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
          requestTimeoutMs: 10_000,
        });
      }

      for (const query of queries) {
        const page = await this.apiClient.fetchPage(query);
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
            marketid: asset?.marketid,
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
        `[GetListingInspectLink] Could not resolve ${normalizedName}:`,
        error,
      );
    }

    if (!inspectLink && phase && defIndex != null && paintIndex != null) {
      const floatValue = (wearCode ? WEAR_FLOAT_MAP[wearCode] : undefined) ?? 0.035;
      inspectLink = buildMaskedInspectLinkFromParams({
        defIndex,
        paintIndex,
        floatValue,
        paintSeed: 0,
        rarity: baseMarketHashName.toLowerCase().includes('glock-18') ? 5 : 6,
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
