import { config } from '../config';
import { normalizeDopplerPhaseLabel } from '../../modules/pricing/domain/DopplerPhase';
import { PriceEnrichmentService } from './PriceEnrichmentService';
import {
  buildInspectLinkFromCertificateHex,
  normalizeSteamWebApiInspectLink,
} from './inspectLinkHelpers';

export const STEAMWEBAPI_INVENTORY_URL =
  'https://www.steamwebapi.com/steam/api/inventory';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_LIMIT = 10_000;
const DEFAULT_MAX_PAGES = 20;

const EXPLICIT_RARITY_PATTERN =
  /(encubierto|covert|cuchillo|knife|guantes|gloves|extraordinario|extraordinary|contrabando|contraband|clasificado|classified|exotic|restringido|restricted|remarkable|militar|mil-spec|high grade|industrial|consumo|consumer|base grade)/i;

function mapExplicitRarity(rawRarity: string): string | null {
  const lower = rawRarity.toLowerCase();
  if (
    lower.includes('covert') ||
    lower.includes('encubierto') ||
    lower.includes('contraband') ||
    lower.includes('extraordinary') ||
    lower.includes('extraordinario') ||
    lower.includes('cuchillo') ||
    lower.includes('knife') ||
    lower.includes('guantes') ||
    lower.includes('gloves')
  ) {
    return 'ancient';
  }
  if (
    lower.includes('classified') ||
    lower.includes('clasificado') ||
    lower.includes('exotic')
  ) {
    return 'legendary';
  }
  if (
    lower.includes('restricted') ||
    lower.includes('restringido') ||
    lower.includes('remarkable')
  ) {
    return 'mythical';
  }
  if (
    lower.includes('mil-spec') ||
    lower.includes('militar') ||
    lower.includes('high grade')
  ) {
    return 'rare';
  }
  if (lower.includes('industrial')) {
    return 'uncommon';
  }
  if (
    lower.includes('consumer') ||
    lower.includes('consumo') ||
    lower.includes('base grade')
  ) {
    return 'common';
  }
  return null;
}

export type SteamWebApiInventoryErrorCode =
  | 'MISSING_API_KEY'
  | 'INVALID_STEAM_ID'
  | 'STEAM_INVENTORY_PRIVATE'
  | 'STEAM_PROFILE_NOT_FOUND'
  | 'STEAMWEBAPI_RATE_LIMIT'
  | 'STEAM_UPSTREAM_UNAVAILABLE'
  | 'STEAMWEBAPI_REQUEST_FAILED';

/** Error estructurado para respuestas fallidas de SteamWebAPI `/steam/api/inventory`. */
export class SteamWebApiInventoryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: SteamWebApiInventoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SteamWebApiInventoryError';
  }
}

export interface SteamWebApiInventoryFloatPayload {
  floatvalue?: number | string | null;
  paintseed?: number | string | null;
  paintindex?: number | string | null;
  phase?: string | null;
  certificate?: string | null;
}

export interface SteamWebApiInventoryRawItem {
  assetid?: string | number;
  asset_id?: string | number;
  classid?: string | number;
  markethashname?: string;
  market_hash_name?: string;
  marketname?: string;
  tradable?: boolean | number;
  marketable?: boolean | number;
  inspectlink?: string | null;
  image?: string | null;
  itemimage?: string | null;
  itemgroup?: string | null;
  itemtype?: string | null;
  quality?: string | null;
  rarity?: string | null;
  type?: string | null;
  paintindex?: number | string | null;
  isstattrak?: boolean;
  issouvenir?: boolean;
  float?: SteamWebApiInventoryFloatPayload | null;
}

export interface FetchSteamInventoryOptions {
  steamId: string;
  game?: string;
  noCache?: boolean;
  state?: 'active' | 'fallback' | 'takedb';
  withNoTradable?: boolean;
  limit?: number;
  maxPages?: number;
  timeoutMs?: number;
}

export interface NormalizedSteamInventoryItem {
  assetId: string;
  classId: string;
  name: string;
  type: string;
  iconUrl: string | null;
  tradable: boolean;
  marketable: boolean;
  inspectLink: string | null;
  rarity: string;
  exterior: string | null;
  category: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
  float: number | null;
  pattern: number | null;
  paintIndex: number | null;
}

function parseFiniteFloat(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseFiniteInt(value: unknown): number | null {
  const num = parseFiniteFloat(value);
  return num !== null ? Math.trunc(num) : null;
}

function extractApiErrorMessage(body: string, fallback: string): string {
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim();
    }
    if (typeof parsed?.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // Plain text response body
  }
  return body.slice(0, 300).trim() || fallback;
}

function mapHttpError(status: number, rawMessage: string): SteamWebApiInventoryError {
  const upper = rawMessage.toUpperCase();

  if (status === 403 || upper === 'PRIVATE' || upper.includes('PRIVATE')) {
    return new SteamWebApiInventoryError(403, 'STEAM_INVENTORY_PRIVATE', rawMessage);
  }
  if (status === 404 || upper.includes('PROFILE_NOT_FOUND')) {
    return new SteamWebApiInventoryError(404, 'STEAM_PROFILE_NOT_FOUND', rawMessage);
  }
  if (status === 401 && upper.includes('STEAM_ID')) {
    return new SteamWebApiInventoryError(401, 'INVALID_STEAM_ID', rawMessage);
  }
  if (status === 402 || status === 429) {
    return new SteamWebApiInventoryError(status, 'STEAMWEBAPI_RATE_LIMIT', rawMessage);
  }
  if (status === 451 || status >= 500) {
    return new SteamWebApiInventoryError(
      status,
      'STEAM_UPSTREAM_UNAVAILABLE',
      rawMessage,
    );
  }
  return new SteamWebApiInventoryError(
    status,
    'STEAMWEBAPI_REQUEST_FAILED',
    rawMessage,
  );
}

/**
 * Normaliza un ítem devuelto por `GET /steam/api/inventory?parse=1` al formato común
 * consumido por el inventario de usuario y el sync de bots.
 */
export function normalizeParsedInventoryItem(
  item: SteamWebApiInventoryRawItem,
): NormalizedSteamInventoryItem | null {
  const rawAssetId = item.assetid ?? item.asset_id;
  if (rawAssetId === undefined || rawAssetId === null || String(rawAssetId).trim() === '') {
    return null;
  }

  const assetId = String(rawAssetId).trim();
  const classId = item.classid !== undefined && item.classid !== null
    ? String(item.classid).trim()
    : '';
  const baseName = String(
    item.markethashname || item.market_hash_name || item.marketname || '',
  ).trim();

  const iconUrl =
    typeof item.image === 'string' && item.image.trim()
      ? item.image.trim()
      : typeof item.itemimage === 'string' && item.itemimage.trim()
        ? item.itemimage.trim()
        : null;

  const floatVal = parseFiniteFloat(item.float?.floatvalue);
  const patternVal = parseFiniteInt(item.float?.paintseed);
  const paintIndexVal =
    parseFiniteInt(item.float?.paintindex) ?? parseFiniteInt(item.paintindex);

  const detectedPhaseLabel =
    normalizeDopplerPhaseLabel(item.float?.phase) ??
    normalizeDopplerPhaseLabel(
      PriceEnrichmentService.detectDopplerPhase(baseName, iconUrl, paintIndexVal),
    );

  const name =
    detectedPhaseLabel &&
    baseName &&
    !baseName.toLowerCase().includes(detectedPhaseLabel.toLowerCase())
      ? `${baseName} | ${detectedPhaseLabel}`
      : baseName;

  const inferred = PriceEnrichmentService.inferDetailsFromMarketHashName(name);
  const explicitRaritySource = [item.rarity, item.type]
    .filter((value): value is string => typeof value === 'string' && EXPLICIT_RARITY_PATTERN.test(value))
    .join(' ');
  const rarity =
    (explicitRaritySource ? mapExplicitRarity(explicitRaritySource) : null) ??
    inferred.rarity;

  const normalizedGroup = typeof item.itemgroup === 'string' ? item.itemgroup.trim().toLowerCase() : '';
  const category =
    inferred.category !== 'other'
      ? inferred.category
      : normalizedGroup || 'other';

  const type =
    (typeof item.itemtype === 'string' && item.itemtype.trim()) ||
    (typeof item.type === 'string' && item.type.trim()) ||
    inferred.type;

  const tradable = item.tradable === true || item.tradable === 1;
  const marketable =
    item.marketable !== undefined
      ? item.marketable === true || item.marketable === 1
      : tradable;

  const inspectLink =
    normalizeSteamWebApiInspectLink(item.inspectlink) ??
    (item.float?.certificate
      ? buildInspectLinkFromCertificateHex(String(item.float.certificate))
      : null);

  return {
    assetId,
    classId,
    name,
    type,
    iconUrl,
    tradable,
    marketable,
    inspectLink,
    rarity,
    exterior: inferred.exterior,
    category,
    isStatTrak:
      inferred.isStatTrak ||
      item.isstattrak === true ||
      (typeof item.quality === 'string' && item.quality.toLowerCase().includes('stattrak')),
    isSouvenir:
      inferred.isSouvenir ||
      item.issouvenir === true ||
      (typeof item.quality === 'string' && item.quality.toLowerCase().includes('souvenir')),
    float: floatVal,
    pattern: patternVal,
    paintIndex: paintIndexVal,
  };
}

/**
 * Cliente HTTP para `GET /steam/api/inventory` de SteamWebAPI.com.
 * Reemplaza las consultas directas a `steamcommunity.com/inventory` con soporte de paginación.
 */
export class SteamWebApiInventoryClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private resolveApiKey(): string {
    return config.steamwebapiApiKey || process.env.STEAMWEBAPI_API_KEY || '';
  }

  async fetchInventory(
    options: FetchSteamInventoryOptions,
  ): Promise<SteamWebApiInventoryRawItem[]> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new SteamWebApiInventoryError(
        500,
        'MISSING_API_KEY',
        'STEAMWEBAPI_API_KEY is not configured',
      );
    }

    const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
    const limit = Math.min(10_000, Math.max(1, options.limit ?? DEFAULT_LIMIT));
    const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const items: SteamWebApiInventoryRawItem[] = [];
    const seenCursors = new Set<string>();
    let startAssetId: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        key: apiKey,
        steam_id: options.steamId,
        game: options.game ?? 'cs2',
        parse: '1',
        state: options.state ?? 'active',
        language: 'english',
        with_no_tradable: (options.withNoTradable ?? true) ? '1' : '0',
        limit: String(limit),
      });

      if (options.noCache && page === 0) {
        params.set('no_cache', '1');
      }
      if (startAssetId) {
        params.set('start_assetid', startAssetId);
      }

      const res = await this.fetchImpl(`${STEAMWEBAPI_INVENTORY_URL}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'X-Api-Key': apiKey,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      // 410 = cuenta sin inventario para CS2, 411 = sin ítems intercambiables
      if (res.status === 410 || res.status === 411) {
        break;
      }

      const rawBody = await res.text();
      if (!res.ok) {
        const message = extractApiErrorMessage(rawBody, res.statusText || `HTTP ${res.status}`);
        throw mapHttpError(res.status, message);
      }

      let payload: any;
      try {
        payload = rawBody ? JSON.parse(rawBody) : [];
      } catch {
        throw new SteamWebApiInventoryError(
          502,
          'STEAMWEBAPI_REQUEST_FAILED',
          'SteamWebAPI returned invalid JSON for inventory',
        );
      }

      const pageItems: SteamWebApiInventoryRawItem[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : [];
      items.push(...pageItems);

      const nextCursor = res.headers.get('last_assetid')?.trim() || '';
      if (!nextCursor || seenCursors.has(nextCursor)) {
        break;
      }
      seenCursors.add(nextCursor);
      startAssetId = nextCursor;
    }

    return items;
  }
}
