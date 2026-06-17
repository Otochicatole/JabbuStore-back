import { MarketListingUpsert } from "../domain/MarketListing";
import { FloatItem } from "../domain/FloatItem";
import { PriceEnrichmentService } from "../../../shared/infrastructure/PriceEnrichmentService";
import { buildInspectLinkFromCertificate } from "../../../shared/infrastructure/inspectLinkHelpers";
import {
  normalizePhaseName,
  resolveAssetPrice,
  stripWearFromMarketHashName,
} from "./floatSyncHelpers";

const PHASE_FROM_API: Record<string, string> = {
  p1: "Phase 1",
  p2: "Phase 2",
  p3: "Phase 3",
  p4: "Phase 4",
  ruby: "Ruby",
  sapphire: "Sapphire",
  "black-pearl": "Black Pearl",
  blackpearl: "Black Pearl",
  emerald: "Emerald",
};

export function resolveListingNameFromAsset(asset: any): string {
  const raw = String(
    asset.markethashname ?? asset.market_hash_name ?? "",
  ).trim();
  if (!raw) return "";

  const phaseKey = asset.phase ? String(asset.phase).toLowerCase() : null;
  const phaseLabel = phaseKey
    ? PHASE_FROM_API[phaseKey] ?? normalizePhaseName(phaseKey) ?? phaseKey
    : null;

  if (!phaseLabel) return raw;

  const base = stripWearFromMarketHashName(raw);
  const wearMatch = raw.match(
    /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i,
  );
  const wearSuffix = wearMatch ? ` (${wearMatch[1]})` : "";
  const withPhase = `${base} | ${phaseLabel}${wearSuffix}`;

  if (raw.toLowerCase().includes(phaseLabel.toLowerCase())) return raw;
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
