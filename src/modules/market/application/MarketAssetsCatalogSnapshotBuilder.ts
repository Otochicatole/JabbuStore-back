import { createHash } from "node:crypto";
import { PriceEnrichmentService } from "../../../shared/infrastructure/PriceEnrichmentService";
import {
  buildInspectLinkFromCertificate,
  isValidInspectLink,
} from "../../../shared/infrastructure/inspectLinkHelpers";
import {
  MARKET_ASSETS_CATALOG_SCHEMA_VERSION,
  type MarketAssetCatalogItem,
  type MarketAssetsCatalogSnapshot,
  type MarketAssetsCatalogSort,
  type MarketAssetsCompletionReason,
} from "../domain/MarketAssetsCatalog";
import type { MarketAssetsPriorityCandidate } from "./MarketAssetsPriorityQueue";
import {
  readAssetPaintIndex,
  resolveAssetImageUrl,
} from "./AssetImageResolver";
import { resolveListingNameFromAsset } from "./floatCatalogMapper";
import {
  assetMatchesListingBase,
  extractWearCode,
  resolveAssetPrice,
  stripWearFromMarketHashName,
} from "./floatSyncHelpers";

export interface BuildMarketAssetsSnapshotInput {
  assets: unknown[];
  providerTotal: number;
  requestedLimit: number;
  sort: MarketAssetsCatalogSort;
  sourceUrl: string;
  completionReason: MarketAssetsCompletionReason;
  fetchedAt?: string;
}

export interface BuildNormalizedMarketAssetsSnapshotInput
  extends Omit<BuildMarketAssetsSnapshotInput, "assets"> {
  assets: MarketAssetCatalogItem[];
  rawAssetCount: number;
  skippedAssetCount: number;
}

export interface NormalizedMarketAssetsBatch {
  assets: MarketAssetCatalogItem[];
  skippedRows: number;
}

function readRequiredId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized && normalized !== "undefined" && normalized !== "null"
    ? normalized
    : null;
}

function readFiniteNumber(...values: unknown[]): number | null {
  for (const raw of values) {
    if (raw === null || raw === undefined || raw === "") continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readBoolean(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function matchesExpectedCandidate(
  asset: Record<string, any>,
  rawMarketHashName: string,
  resolvedListingName: string,
  expected: MarketAssetsPriorityCandidate,
): boolean {
  if (expected.phase) {
    const rawWithoutWear = stripWearFromMarketHashName(rawMarketHashName);
    const phaseSuffix = ` | ${expected.phase}`.toLowerCase();
    const rawWithoutExplicitPhase = rawWithoutWear
      .toLowerCase()
      .endsWith(phaseSuffix)
      ? rawWithoutWear.slice(0, -phaseSuffix.length)
      : rawWithoutWear;
    if (
      !assetMatchesListingBase(
        rawWithoutExplicitPhase,
        expected.queryMarketHashName,
      ) && resolvedListingName !== expected.marketHashName
    ) {
      return false;
    }
    if (
      expected.wear &&
      extractWearCode(rawMarketHashName) !== expected.wear
    ) {
      return false;
    }
  } else if (resolvedListingName !== expected.marketHashName) {
    return false;
  }

  if (expected.paintIndex != null) {
    const actualPaintIndex = readAssetPaintIndex(asset);
    if (actualPaintIndex !== expected.paintIndex) return false;
  }

  const actualStatTrak =
    readBoolean(
      asset.isstattrak ??
        asset.is_stattrak ??
        asset.item?.isstattrak ??
        asset.item?.is_stattrak,
    ) ?? /stattrak/i.test(expected.marketHashName);
  const actualSouvenir =
    readBoolean(
      asset.issouvenir ??
        asset.is_souvenir ??
        asset.item?.issouvenir ??
        asset.item?.is_souvenir,
    ) ?? /^souvenir\s/i.test(expected.marketHashName);

  return (
    actualStatTrak === expected.isStatTrak &&
    actualSouvenir === expected.isSouvenir
  );
}

export function normalizeMarketAsset(
  raw: unknown,
  expected?: MarketAssetsPriorityCandidate,
): MarketAssetCatalogItem | null {
  if (!raw || typeof raw !== "object") return null;
  const asset = raw as Record<string, any>;
  if (String(asset.source ?? "").trim().toLowerCase() !== "youpin") {
    return null;
  }

  const assetId = readRequiredId(asset.assetid ?? asset.asset_id ?? asset.id);
  const externalId = readRequiredId(asset.marketid ?? asset.market_id);
  const marketHashName = String(
    asset.markethashname ?? asset.market_hash_name ?? "",
  ).trim();
  const resolvedListingName = resolveListingNameFromAsset(asset);
  // Para variantes, items-catalog es la fuente de verdad del par fase/paint
  // index. Algunos índices nuevos todavía no existen en los mapas legacy.
  const listingName = expected?.phase
    ? expected.marketHashName
    : resolvedListingName;
  const floatValue = readFiniteNumber(asset.float, asset.float_value);
  const paintSeed = readFiniteNumber(
    asset.paintseed,
    asset.paint_seed,
    asset.paintSeed,
  );
  const price = resolveAssetPrice(asset);
  const iconUrl = resolveAssetImageUrl(asset);

  if (
    !assetId ||
    !externalId ||
    !marketHashName ||
    !listingName ||
    floatValue == null ||
    floatValue < 0 ||
    floatValue > 1 ||
    paintSeed == null ||
    paintSeed < 0 ||
    !Number.isInteger(paintSeed) ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !iconUrl ||
    (expected &&
      !matchesExpectedCandidate(
        asset,
        marketHashName,
        resolvedListingName,
        expected,
      ))
  ) {
    return null;
  }

  const certificate = readRequiredId(asset.certificate);
  const generatedInspectLink = certificate
    ? buildInspectLinkFromCertificate(certificate, {
        marketid: externalId,
        assetid: assetId,
        steamid: asset.steamid,
      })
    : null;
  const rawInspectLink =
    typeof asset.inspectlink === "string" ? asset.inspectlink : null;
  const inspectLink = isValidInspectLink(generatedInspectLink)
    ? generatedInspectLink!.trim()
    : isValidInspectLink(rawInspectLink)
      ? rawInspectLink!.trim()
      : null;
  const details =
    PriceEnrichmentService.inferDetailsFromMarketHashName(listingName);

  return {
    assetId,
    externalId,
    marketHashName,
    listingName,
    floatValue,
    paintSeed,
    price,
    inspectLink,
    iconUrl,
    rarity: details.rarity,
    exterior: details.exterior,
    category: details.category,
    isStatTrak: details.isStatTrak,
    isSouvenir: details.isSouvenir,
  };
}

export class MarketAssetsCatalogSnapshotBuilder {
  normalizeMany(
    rawAssets: unknown[],
    expected?: MarketAssetsPriorityCandidate,
  ): NormalizedMarketAssetsBatch {
    const byAssetId = new Map<string, MarketAssetCatalogItem>();
    let skippedRows = 0;

    for (const raw of rawAssets) {
      const item = normalizeMarketAsset(raw, expected);
      if (!item || byAssetId.has(item.assetId)) {
        skippedRows++;
        continue;
      }
      byAssetId.set(item.assetId, item);
    }

    return { assets: [...byAssetId.values()], skippedRows };
  }

  build(input: BuildMarketAssetsSnapshotInput): MarketAssetsCatalogSnapshot {
    const normalized = this.normalizeMany(input.assets);
    return this.buildNormalized({
      ...input,
      assets: normalized.assets,
      rawAssetCount: input.assets.length,
      skippedAssetCount: normalized.skippedRows,
    });
  }

  buildNormalized(
    input: BuildNormalizedMarketAssetsSnapshotInput,
  ): MarketAssetsCatalogSnapshot {
    if (
      input.rawAssetCount !==
      input.assets.length + input.skippedAssetCount
    ) {
      throw new Error(
        "Las métricas del snapshot no coinciden con sus assets válidos y descartados.",
      );
    }
    if (/(?:\?|&)key=/i.test(input.sourceUrl)) {
      throw new Error("La URL del snapshot no puede contener la API key.");
    }

    const version = createHash("sha256")
      .update(JSON.stringify(input.assets))
      .digest("hex");

    return {
      schemaVersion: MARKET_ASSETS_CATALOG_SCHEMA_VERSION,
      version,
      fetchedAt: input.fetchedAt ?? new Date().toISOString(),
      source: "youpin",
      sourceUrl: input.sourceUrl,
      sort: input.sort,
      requestedLimit: input.requestedLimit,
      providerTotal: input.providerTotal,
      rawAssetCount: input.rawAssetCount,
      validAssetCount: input.assets.length,
      skippedAssetCount: input.skippedAssetCount,
      completionReason: input.completionReason,
      assets: input.assets,
    };
  }
}
