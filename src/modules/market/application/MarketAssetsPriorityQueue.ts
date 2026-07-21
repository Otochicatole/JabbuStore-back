import { createHash } from "node:crypto";
import type {
  SteamWebApiItemVariant,
  SteamWebApiItemsCatalogRow,
  SteamWebApiItemsCatalogSnapshot,
} from "../../pricing";
import { normalizeDopplerPhaseLabel } from "../../pricing/domain/DopplerPhase";
import {
  extractWearCode,
  isSouvenirName,
  isStatTrakName,
  resolveDefIndexFromBaseName,
} from "./floatSyncHelpers";

const SKIN_GROUPS = new Set([
  "knife",
  "glove",
  "gloves",
  "pistol",
  "rifle",
  "sniper rifle",
  "smg",
  "shotgun",
  "machinegun",
  "machine gun",
]);

const CONSUMABLE_GROUPS = new Set([
  "agent",
  "case",
  "capsule",
  "charm",
  "collectible",
  "container",
  "graffiti",
  "key",
  "music kit",
  "patch",
  "pass",
  "sticker",
  "tool",
]);

const CONSUMABLE_NAME_PATTERNS = [
  /^agent\s*\|/i,
  /^charm\s*\|/i,
  /^collectible\s*\|/i,
  /^container\s*\|/i,
  /^graffiti\s*\|/i,
  /^music kit\s*\|/i,
  /^patch\s*\|/i,
  /^separate/i,
  /^sticker\s*\|/i,
  /^sticker slab\s*\|/i,
  /\bcapsule$/i,
  /\bcase$/i,
  /\bkey$/i,
  /\bpackage$/i,
  /\bpass$/i,
  / souvenir package/i,
];

const WEAR_SUFFIX =
  /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i;

export interface MarketAssetsPriorityCandidate {
  /** Identidad durable usada en el checkpoint. */
  key: string;
  /** Nombre final del listing; incluye fase y desgaste cuando corresponde. */
  marketHashName: string;
  /** Nombre de catálogo usado para la consulta exacta cuando no hay fase. */
  queryMarketHashName: string;
  priorityPrice: number;
  phase: string | null;
  paintIndex: number | null;
  wear: string | null;
  defIndex: number | null;
  isStatTrak: boolean;
  isSouvenir: boolean;
}

export interface MarketAssetsPriorityQueue {
  /** SHA-256 del contenido normalizado real de la cola, no de timestamps. */
  version: string;
  candidates: MarketAssetsPriorityCandidate[];
}

export interface ItemsCatalogReader {
  readCatalog(): Promise<SteamWebApiItemsCatalogSnapshot | null>;
}

export type MarketAssetsPriorityQueueErrorKind =
  | "catalog_missing"
  | "catalog_invalid"
  | "catalog_empty";

/**
 * Fallo de readiness del catálogo local. El scheduler puede distinguirlo de
 * errores de SteamWebAPI y volver a comprobarlo sin esperar el ciclo de 12 h.
 */
export class MarketAssetsPriorityQueueError extends Error {
  constructor(
    readonly kind: MarketAssetsPriorityQueueErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "MarketAssetsPriorityQueueError";
  }
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readPositivePrice(...values: unknown[]): number | null {
  for (const raw of values) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function readPaintIndex(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

export function getCatalogMarketHashName(
  row: SteamWebApiItemsCatalogRow,
): string | null {
  const value =
    row.markethashname ??
    row.market_hash_name ??
    row.marketname ??
    row.normalizedname;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readCatalogPriorityPrice(
  row: Pick<
    SteamWebApiItemsCatalogRow,
    "pricereal" | "pricemix" | "pricelatest"
  >,
): number | null {
  return readPositivePrice(row.pricereal, row.pricemix, row.pricelatest);
}

export function readVariantPriorityPrice(
  variant: SteamWebApiItemVariant,
): number | null {
  return readPositivePrice(
    variant.pricereal,
    variant.pricemix,
    variant.pricelatest,
  );
}

export function isRealSkinCatalogRow(
  row: SteamWebApiItemsCatalogRow,
): boolean {
  const name = getCatalogMarketHashName(row);
  if (!name) return false;

  const itemGroup = normalize(row.itemgroup);
  const itemType = normalize(row.itemtype);
  const wear = normalize(row.wear);
  const lowerName = name.toLowerCase();

  if (CONSUMABLE_GROUPS.has(itemGroup) || CONSUMABLE_GROUPS.has(itemType)) {
    return false;
  }
  if (CONSUMABLE_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return false;
  }
  if (SKIN_GROUPS.has(itemGroup) || SKIN_GROUPS.has(itemType)) return true;
  if (wear || WEAR_SUFFIX.test(name)) return true;

  return (
    lowerName.includes(" | ") &&
    (lowerName.startsWith("★") ||
      lowerName.includes("knife") ||
      lowerName.includes("gloves"))
  );
}

/** Inserta la fase antes del desgaste usando el mismo formato del publicador. */
export function buildVariantListingName(
  baseMarketHashName: string,
  phase: string,
): string {
  const canonicalPhase = normalizeDopplerPhaseLabel(phase) ?? phase.trim();
  const wearMatch = baseMarketHashName.match(WEAR_SUFFIX);
  const wearSuffix = wearMatch?.[1] ? ` (${wearMatch[1]})` : "";
  const withoutWear = baseMarketHashName.replace(WEAR_SUFFIX, "").trim();

  // El catálogo base no debería incluir fase, pero evitamos duplicarla si cambia.
  if (withoutWear.endsWith(` | ${canonicalPhase}`)) {
    return `${withoutWear}${wearSuffix}`;
  }
  return `${withoutWear} | ${canonicalPhase}${wearSuffix}`;
}

function buildCandidate(
  row: SteamWebApiItemsCatalogRow,
  baseName: string,
  priorityPrice: number,
  variant?: SteamWebApiItemVariant,
): Omit<MarketAssetsPriorityCandidate, "key"> | null {
  const rawPhase = variant?.phase?.trim() || null;
  const phase = rawPhase
    ? (normalizeDopplerPhaseLabel(rawPhase) ?? rawPhase)
    : null;
  const paintIndex = readPaintIndex(
    variant?.paintindex ?? variant?.paint_index ?? row.paintindex,
  );
  if (variant && (!phase || paintIndex == null)) return null;

  const marketHashName = phase
    ? buildVariantListingName(baseName, phase)
    : baseName;
  const wear =
    extractWearCode(marketHashName) ?? (normalize(row.wear) || null);
  const isStatTrak =
    readBoolean(row.isstattrak) ?? isStatTrakName(marketHashName);
  const isSouvenir =
    readBoolean(row.issouvenir) ?? isSouvenirName(marketHashName);

  return {
    marketHashName,
    queryMarketHashName: baseName,
    priorityPrice,
    phase,
    paintIndex,
    wear,
    defIndex: phase ? resolveDefIndexFromBaseName(baseName) : null,
    isStatTrak,
    isSouvenir,
  };
}

function candidateKey(
  candidate: Omit<MarketAssetsPriorityCandidate, "key">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        marketHashName: candidate.marketHashName,
        queryMarketHashName: candidate.queryMarketHashName,
        phase: candidate.phase,
        paintIndex: candidate.paintIndex,
        wear: candidate.wear,
        defIndex: candidate.defIndex,
        isStatTrak: candidate.isStatTrak,
        isSouvenir: candidate.isSouvenir,
      }),
    )
    .digest("hex");
}

function expandRow(
  row: SteamWebApiItemsCatalogRow,
): MarketAssetsPriorityCandidate[] {
  const baseName = getCatalogMarketHashName(row);
  if (!baseName || !isRealSkinCatalogRow(row)) return [];

  const variants = Array.isArray(row.variants) ? row.variants : [];
  if (variants.length > 0) {
    return variants.flatMap((variant) => {
      const price = readVariantPriorityPrice(variant);
      if (price == null) return [];
      const candidate = buildCandidate(row, baseName, price, variant);
      return candidate ? [{ ...candidate, key: candidateKey(candidate) }] : [];
    });
  }

  const price = readCatalogPriorityPrice(row);
  if (price == null) return [];
  const candidate = buildCandidate(row, baseName, price);
  return candidate ? [{ ...candidate, key: candidateKey(candidate) }] : [];
}

export class MarketAssetsPriorityQueueBuilder {
  constructor(private readonly catalogReader: ItemsCatalogReader) {}

  async build(): Promise<MarketAssetsPriorityQueue> {
    let snapshot: SteamWebApiItemsCatalogSnapshot | null;
    try {
      snapshot = await this.catalogReader.readCatalog();
    } catch (error) {
      throw new MarketAssetsPriorityQueueError(
        "catalog_invalid",
        `No se pudo leer items-catalog.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!snapshot || !Array.isArray(snapshot.items)) {
      throw new MarketAssetsPriorityQueueError(
        "catalog_missing",
        "El catálogo local items-catalog.json no está disponible. Descargalo antes de sincronizar YouPin.",
      );
    }
    if (Array.isArray(snapshot.errors) && snapshot.errors.length > 0) {
      throw new MarketAssetsPriorityQueueError(
        "catalog_invalid",
        `items-catalog.json fue generado con errores: ${snapshot.errors.join("; ")}`,
      );
    }

    const byListingName = new Map<string, MarketAssetsPriorityCandidate>();
    for (const row of snapshot.items) {
      for (const candidate of expandRow(row)) {
        const existing = byListingName.get(candidate.marketHashName);
        if (!existing || candidate.priorityPrice > existing.priorityPrice) {
          byListingName.set(candidate.marketHashName, candidate);
        }
      }
    }

    const candidates = [...byListingName.values()].sort(
      (left, right) =>
        right.priorityPrice - left.priorityPrice ||
        left.marketHashName.localeCompare(right.marketHashName, "en"),
    );
    if (candidates.length === 0) {
      throw new MarketAssetsPriorityQueueError(
        "catalog_empty",
        "items-catalog.json no contiene skins con precio válido.",
      );
    }

    const canonicalContent = candidates.map((candidate) => ({
      key: candidate.key,
      marketHashName: candidate.marketHashName,
      queryMarketHashName: candidate.queryMarketHashName,
      priorityPrice: candidate.priorityPrice,
      phase: candidate.phase,
      paintIndex: candidate.paintIndex,
      wear: candidate.wear,
      defIndex: candidate.defIndex,
      isStatTrak: candidate.isStatTrak,
      isSouvenir: candidate.isSouvenir,
    }));
    const version = createHash("sha256")
      .update(JSON.stringify(canonicalContent))
      .digest("hex");

    return { version, candidates };
  }
}
