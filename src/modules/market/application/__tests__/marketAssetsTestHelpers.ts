import type { IMarketSyncStateRepository } from "../../domain/IMarketSyncStateRepository";
import type {
  IMarketAssetsCatalogStore,
  MarketAssetCatalogItem,
  MarketAssetsCatalogSnapshot,
  MarketAssetsCollectionCheckpoint,
} from "../../domain/MarketAssetsCatalog";
import type { SteamWebApiItemsCatalogRow } from "../../../pricing";
import {
  MarketAssetsPriorityQueueBuilder,
  type ItemsCatalogReader,
} from "../MarketAssetsPriorityQueue";

export function catalogReader(
  items: SteamWebApiItemsCatalogRow[],
  options: { fetchedAt?: string; errors?: string[] } = {},
): ItemsCatalogReader {
  return {
    async readCatalog() {
      return {
        fetchedAt: options.fetchedAt ?? "2026-07-20T00:00:00.000Z",
        currency: "USD",
        market: "youpin",
        sourceUrl: "https://example.test/items",
        pageCount: 1,
        itemCount: items.length,
        errors: options.errors ?? [],
        items,
      };
    },
  };
}

export function priorityQueue(
  items: SteamWebApiItemsCatalogRow[],
): MarketAssetsPriorityQueueBuilder {
  return new MarketAssetsPriorityQueueBuilder(catalogReader(items));
}

export class MemoryMarketAssetsCatalogStore
  implements IMarketAssetsCatalogStore
{
  snapshot: MarketAssetsCatalogSnapshot | null = null;
  checkpoint: MarketAssetsCollectionCheckpoint | null = null;
  checkpointWrites: MarketAssetsCollectionCheckpoint[] = [];
  deletedCheckpoints = 0;

  async readCatalog(): Promise<MarketAssetsCatalogSnapshot | null> {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }

  async writeCatalog(snapshot: MarketAssetsCatalogSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
  }

  async readCheckpoint(): Promise<MarketAssetsCollectionCheckpoint | null> {
    return this.checkpoint ? structuredClone(this.checkpoint) : null;
  }

  async writeCheckpoint(
    checkpoint: MarketAssetsCollectionCheckpoint,
  ): Promise<void> {
    this.checkpoint = structuredClone(checkpoint);
    this.checkpointWrites.push(structuredClone(checkpoint));
  }

  async deleteCheckpoint(): Promise<void> {
    this.checkpoint = null;
    this.deletedCheckpoints++;
  }

  async getStatus() {
    return {
      exists: Boolean(this.snapshot),
      path: "memory://market-assets.json",
      version: this.snapshot?.version ?? null,
      fetchedAt: this.snapshot?.fetchedAt ?? null,
      requestedLimit: this.snapshot?.requestedLimit ?? 10_000,
      providerTotal: this.snapshot?.providerTotal ?? 0,
      rawAssetCount: this.snapshot?.rawAssetCount ?? 0,
      validAssetCount: this.snapshot?.validAssetCount ?? 0,
      skippedAssetCount: this.snapshot?.skippedAssetCount ?? 0,
      completionReason: this.snapshot?.completionReason ?? null,
    };
  }

  async getCheckpointStatus() {
    return {
      exists: Boolean(this.checkpoint),
      path: "memory://market-assets.pending.json",
      queueVersion: this.checkpoint?.queueVersion ?? null,
      targetAssets: this.checkpoint?.targetAssets ?? 10_000,
      validAssetCount: this.checkpoint?.assets.length ?? 0,
      rawAssetCount: this.checkpoint?.rawAssetCount ?? 0,
      skippedAssetCount: this.checkpoint?.skippedAssetCount ?? 0,
      cursorIndex: this.checkpoint?.cursorIndex ?? 0,
      candidatesVisited: this.checkpoint?.candidatesVisited ?? 0,
      totalCandidates: this.checkpoint?.totalCandidates ?? 0,
      rowsUsed: this.checkpoint?.rowsUsed ?? 0,
      quotaUnitsUsed: this.checkpoint?.quotaUnitsUsed ?? 0,
      creditsUsed: this.checkpoint?.creditsUsed ?? 0,
      updatedAt: this.checkpoint?.updatedAt ?? null,
    };
  }
}

export function syncStateRepository(): IMarketSyncStateRepository {
  return {
    async get() {
      return null;
    },
    async markStarted() {},
    async markCollectionProgress() {},
    async updateCurrentStatus() {},
    async markSnapshotSaved() {},
    async markPublished() {},
    async markFullSuccess() {},
    async markFailed() {},
    async markCancelled() {},
    async markFinished() {},
  };
}

export function rawMarketAsset(
  marketHashName: string,
  assetId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const overriddenItem =
    overrides.item && typeof overrides.item === "object"
      ? (overrides.item as Record<string, unknown>)
      : {};
  return {
    source: "youpin",
    assetid: assetId,
    marketid: `market-${assetId}`,
    markethashname: marketHashName,
    float: 0.1234,
    paintseed: 42,
    price: 50,
    ...overrides,
    item: {
      image: "https://example.test/skin.png",
      ...overriddenItem,
    },
  };
}

export function marketAsset(
  assetId: string,
  listingName = "AK-47 | Redline (Field-Tested)",
  overrides: Partial<MarketAssetCatalogItem> = {},
): MarketAssetCatalogItem {
  return {
    assetId,
    externalId: `market-${assetId}`,
    marketHashName: listingName,
    listingName,
    floatValue: 0.1234,
    paintSeed: 42,
    price: 50,
    inspectLink: null,
    iconUrl: "https://example.test/skin.png",
    rarity: "Classified",
    exterior: "Field-Tested",
    category: "Rifle",
    isStatTrak: false,
    isSouvenir: false,
    ...overrides,
  };
}
