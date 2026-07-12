import { config } from "../../../shared/config";
import type {
  SteamWebApiItemsCatalogRow,
  SteamWebApiItemsCatalogSnapshot,
} from "../../pricing";
import { SteamWebApiItemsCatalogStore } from "../../pricing";

export interface MarketPriorityCandidate {
  marketHashName: string;
  priorityPrice: number;
  iconUrl: string | null;
}

export interface MarketPriorityQueue {
  queueVersion: string;
  candidates: MarketPriorityCandidate[];
  catalogAvailable: boolean;
  reason?: string;
}

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
  / capsule($|\s|\|)/i,
  / case($|\s|\|)/i,
  / key($|\s|\|)/i,
  / package($|\s|\|)/i,
  / pass($|\s|\|)/i,
  / souvenir package/i,
];

const WEAR_SUFFIX =
  /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i;

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function readCatalogPriorityPrice(
  row: Pick<SteamWebApiItemsCatalogRow, "pricereal" | "pricemix" | "pricelatest">,
): number | null {
  const price = Number(row.pricereal ?? row.pricemix ?? row.pricelatest);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function getCatalogMarketHashName(
  row: SteamWebApiItemsCatalogRow,
): string | null {
  const name =
    row.markethashname ??
    row.market_hash_name ??
    row.marketname ??
    row.normalizedname;

  return typeof name === "string" && name.trim().length > 0
    ? name.trim()
    : null;
}

export function isRealSkinCatalogRow(row: SteamWebApiItemsCatalogRow): boolean {
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

  if (SKIN_GROUPS.has(itemGroup) || SKIN_GROUPS.has(itemType)) {
    return true;
  }

  if (wear || WEAR_SUFFIX.test(name)) {
    return true;
  }

  return (
    lowerName.includes(" | ") &&
    (lowerName.startsWith("★") ||
      lowerName.includes("knife") ||
      lowerName.includes("gloves"))
  );
}

function buildQueueVersion(snapshot: SteamWebApiItemsCatalogSnapshot): string {
  return `${snapshot.fetchedAt}:${snapshot.itemCount}`;
}

export class MarketPriorityDiscoveryQueue {
  constructor(private catalogStore = new SteamWebApiItemsCatalogStore()) {}

  async build(): Promise<MarketPriorityQueue> {
    const snapshot = await this.catalogStore.readCatalog();
    if (!snapshot || !Array.isArray(snapshot.items)) {
      return {
        queueVersion: "missing",
        candidates: [],
        catalogAvailable: false,
        reason: "Catálogo local Items API no disponible. Descargalo desde el admin.",
      };
    }

    const byName = new Map<string, MarketPriorityCandidate>();

    for (const row of snapshot.items) {
      if (!isRealSkinCatalogRow(row)) continue;

      const marketHashName = getCatalogMarketHashName(row);
      const priorityPrice = readCatalogPriorityPrice(row);
      if (!marketHashName || priorityPrice == null) continue;

      const existing = byName.get(marketHashName);
      if (existing && existing.priorityPrice >= priorityPrice) continue;

      byName.set(marketHashName, {
        marketHashName,
        priorityPrice,
        iconUrl: row.image ?? null,
      });
    }

    const candidates = [...byName.values()]
      .filter((candidate) => candidate.priorityPrice > config.marketSync.minPrice)
      .sort((a, b) => b.priorityPrice - a.priorityPrice);

    return {
      queueVersion: buildQueueVersion(snapshot),
      candidates,
      catalogAvailable: true,
    };
  }
}

