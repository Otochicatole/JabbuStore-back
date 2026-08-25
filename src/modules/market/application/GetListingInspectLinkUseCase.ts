import {
  buildInspectLinkFromCertificate,
  isValidInspectLink,
} from '../../../shared/infrastructure/inspectLinkHelpers';
import type { SteamWebApiFloatAssetsClient } from '../infrastructure/SteamWebApiFloatAssetsClient';

export interface ListingInspectAssetsClient {
  fetchPage(query: {
    source: 'youpin';
    marketHashName: string;
    limit: number;
    offset: number;
    sort: 'newest';
    onlyMarketId: boolean;
    withItems: boolean;
    rateLimitPriority: 'normal';
    requestTimeoutMs: number;
  }): Promise<{ ok: boolean; assets: any[] }>;
}

interface CachedInspectLink {
  expiresAt: number;
  inspectLink: string | null;
}

const INSPECT_CACHE_TTL_MS = 10 * 60 * 1000;

/** Resolves a real Steam inspect link without exposing SteamWebAPI credentials. */
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

    let inspectLink: string | null = null;
    try {
      const page = await this.apiClient.fetchPage({
        source: 'youpin',
        marketHashName: normalizedName,
        limit: 10,
        offset: 0,
        sort: 'newest',
        onlyMarketId: true,
        withItems: true,
        rateLimitPriority: 'normal',
        requestTimeoutMs: 10_000,
      });

      if (page.ok) {
        for (const asset of page.assets) {
          const rawName = String(
            asset?.markethashname ?? asset?.market_hash_name ?? '',
          ).trim();
          if (rawName && rawName !== normalizedName) continue;

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
      }
    } catch (error) {
      console.warn(
        `[GetListingInspectLink] Could not resolve ${normalizedName}:`,
        error,
      );
    }

    this.cache.set(normalizedName, {
      expiresAt: now + this.cacheTtlMs,
      inspectLink,
    });
    return inspectLink;
  }
}
