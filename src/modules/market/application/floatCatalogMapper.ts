import { MarketListingUpsert } from "../domain/MarketListing";
import { FloatItem } from "../domain/FloatItem";
import { PriceEnrichmentService } from "../../../shared/infrastructure/PriceEnrichmentService";
import { buildInspectLinkFromCertificate } from "../../../shared/infrastructure/inspectLinkHelpers";
import {
  getDopplerPhaseLabelByPaintIndex,
  normalizeDopplerPhaseLabel,
} from "../../pricing/domain/DopplerPhase";
import { resolveAssetPrice } from "./floatSyncHelpers";

const WEAR_SUFFIX =
  /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i;

function stripWearFromMarketHashName(name: string): string {
  return name.replace(WEAR_SUFFIX, "").trim();
}

function getWearSuffix(name: string): string {
  const match = name.match(WEAR_SUFFIX);
  return match?.[1] ? ` (${match[1]})` : "";
}

function toDisplayPhaseName(rawPhase: string | null | undefined): string | null {
  return normalizeDopplerPhaseLabel(rawPhase);
}

function readAssetPaintIndex(asset: any): number | null {
  const raw =
    asset.paintindex ??
    asset.paint_index ??
    asset.paintIndex ??
    asset.item?.paintindex ??
    asset.item?.paint_index ??
    asset.item?.paintIndex ??
    asset.metadata?.paintindex ??
    asset.metadata?.paint_index ??
    asset.metadata?.paintIndex;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function splitRawName(raw: string): {
  base: string;
  phaseLabel: string | null;
  wearSuffix: string;
} {
  const parts = raw.split(" | ").map((part) => part.trim());
  const wearPart = parts.find((part) => WEAR_SUFFIX.test(part));
  const wearSuffix = wearPart ? getWearSuffix(wearPart) : "";
  const phaseIndex = parts.findIndex(
    (part, index) => index > 1 && toDisplayPhaseName(part) != null,
  );
  const phaseLabel =
    phaseIndex >= 0 ? toDisplayPhaseName(parts[phaseIndex]) : null;

  if (!phaseLabel) {
    return {
      base: stripWearFromMarketHashName(raw),
      phaseLabel: null,
      wearSuffix: getWearSuffix(raw),
    };
  }

  return {
    base: parts
      .filter((_part, index) => index !== phaseIndex)
      .map(stripWearFromMarketHashName)
      .join(" | "),
    phaseLabel,
    wearSuffix,
  };
}

function resolveAssetPhaseLabel(asset: any, rawName: string): string | null {
  const paintPhase = getDopplerPhaseLabelByPaintIndex(readAssetPaintIndex(asset));
  if (paintPhase) return paintPhase;

  const explicitPhase = toDisplayPhaseName(
    asset.phase ?? asset.item?.phase ?? asset.metadata?.phase,
  );
  if (explicitPhase) return explicitPhase;

  const { phaseLabel } = splitRawName(rawName);
  if (phaseLabel) return phaseLabel;

  return null;
}

export function resolveListingNameFromAsset(asset: any): string {
  const raw = String(
    asset.markethashname ?? asset.market_hash_name ?? "",
  ).trim();
  if (!raw) return "";

  const phaseLabel = resolveAssetPhaseLabel(asset, raw);
  if (!phaseLabel) {
    return /\b(?:Gamma\s+)?Doppler\b/i.test(raw) ? "" : raw;
  }

  const { base, wearSuffix } = splitRawName(raw);
  const withPhase = `${base} | ${phaseLabel}${wearSuffix}`;

  return withPhase;
}

export function assetToFloatItem(asset: any, resaleItemId: string): FloatItem | null {
  if (asset?.source !== "youpin") return null;
  if (asset.float === undefined || asset.float === null) return null;

  const price = resolveAssetPrice(asset);
  if (price <= 0) return null;

  const inspectLink = asset.certificate
    ? buildInspectLinkFromCertificate(String(asset.certificate), {
        marketid: asset.marketid,
        assetid: asset.assetid,
        steamid: asset.steamid,
      })
    : null;

  return {
    assetId: String(asset.assetid ?? asset.asset_id ?? asset.id),
    floatValue: Number(asset.float),
    paintSeed: Number(asset.paintseed ?? asset.paint_seed) || 0,
    market: "YOUPIN",
    price,
    inspectLink,
    available: true,
    externalId: asset.marketid
      ? String(asset.marketid)
      : String(asset.id ?? asset.assetid),
    lastSyncAt: new Date(),
    resaleItemId,
  };
}

export interface CatalogGroup {
  listing: MarketListingUpsert;
  floats: Omit<FloatItem, "resaleItemId">[];
}

export function groupYoupinAssetsIntoCatalog(
  assets: any[],
  minPrice: number,
): { groups: Map<string, CatalogGroup>; skipped: number } {
  const groups = new Map<string, CatalogGroup>();
  let skipped = 0;

  for (const asset of assets) {
    if (asset?.source !== "youpin") {
      skipped++;
      continue;
    }

    const name = resolveListingNameFromAsset(asset);
    if (!name) {
      skipped++;
      continue;
    }

    const price = resolveAssetPrice(asset);
    if (price <= minPrice) {
      skipped++;
      continue;
    }

    const floatDraft = assetToFloatItem(asset, "pending");
    if (!floatDraft) {
      skipped++;
      continue;
    }

    const { resaleItemId: _ignored, ...floatData } = floatDraft;
    const details = PriceEnrichmentService.inferDetailsFromMarketHashName(name);
    const itemMeta = asset.item ?? {};
    const iconUrl = itemMeta.itemimage ?? asset.itemimage ?? null;

    let group = groups.get(name);
    if (!group) {
      group = {
        listing: {
          name,
          provider: "youpin",
          youpinAsk: price,
          youpinVolume: 1,
          price,
          iconUrl,
          rarity: details.rarity,
          exterior: details.exterior,
          category: details.category,
          isStatTrak: details.isStatTrak,
          isSouvenir: details.isSouvenir,
        },
        floats: [],
      };
      groups.set(name, group);
    } else {
      group.listing.youpinVolume = (group.listing.youpinVolume ?? 0) + 1;
      if (price < group.listing.price) {
        group.listing.price = price;
        group.listing.youpinAsk = price;
      }
      if (!group.listing.iconUrl && iconUrl) {
        group.listing.iconUrl = iconUrl;
      }
    }

    group.floats.push(floatData);
  }

  return { groups, skipped };
}
