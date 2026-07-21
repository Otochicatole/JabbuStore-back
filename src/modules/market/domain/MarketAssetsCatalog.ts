export const MARKET_ASSETS_CATALOG_SCHEMA_VERSION = 1 as const;
export const MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION = 2 as const;

export type MarketAssetsCatalogSort =
  | "newest"
  | "oldest"
  | "lowest_float"
  | "highest_float";

export type MarketAssetsCompletionReason =
  | "target_reached"
  | "catalog_exhausted";

/** Asset YouPin completamente validado y seguro para publicar. */
export interface MarketAssetCatalogItem {
  assetId: string;
  externalId: string;
  marketHashName: string;
  listingName: string;
  floatValue: number;
  paintSeed: number;
  price: number;
  inspectLink: string | null;
  iconUrl: string;
  rarity: string;
  exterior: string | null;
  category: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
}

export interface MarketAssetsCatalogSnapshot {
  schemaVersion: typeof MARKET_ASSETS_CATALOG_SCHEMA_VERSION;
  version: string;
  fetchedAt: string;
  source: "youpin";
  /** URL representativa sin API key. */
  sourceUrl: string;
  sort: MarketAssetsCatalogSort;
  requestedLimit: number;
  providerTotal: number;
  rawAssetCount: number;
  validAssetCount: number;
  skippedAssetCount: number;
  completionReason: MarketAssetsCompletionReason;
  assets: MarketAssetCatalogItem[];
}

/**
 * Progreso durable de un candidato. Los candidatos pueden terminar fuera de
 * orden por la concurrencia; `cursorIndex` siempre apunta al primer candidato
 * incompleto de la cola priorizada.
 */
export interface MarketAssetsCandidateCheckpoint {
  offset: number;
  validAssetCount: number;
  rawAssetCount: number;
  skippedAssetCount: number;
  quotaUnitsUsed: number;
  creditsUsed: number;
  providerTotal: number;
  consecutiveFailures: number;
  completed: boolean;
  exhausted: boolean;
  lastError: string | null;
}

export interface MarketAssetsCollectionCheckpoint {
  schemaVersion: typeof MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION;
  queueVersion: string;
  targetAssets: number;
  assetsPerItem: number;
  sort: MarketAssetsCatalogSort;
  concurrency: number;
  cursorIndex: number;
  candidatesVisited: number;
  totalCandidates: number;
  /** Alias histórico; equivale a `quotaUnitsUsed`. */
  rowsUsed: number;
  quotaUnitsUsed: number;
  creditsUsed: number;
  rawAssetCount: number;
  skippedAssetCount: number;
  providerTotal: number;
  startedAt: string;
  updatedAt: string;
  candidateProgress: Record<string, MarketAssetsCandidateCheckpoint>;
  assets: MarketAssetCatalogItem[];
}

export interface MarketAssetsCheckpointFileStatus {
  exists: boolean;
  path: string;
  queueVersion: string | null;
  targetAssets: number;
  validAssetCount: number;
  rawAssetCount: number;
  skippedAssetCount: number;
  cursorIndex: number;
  candidatesVisited: number;
  totalCandidates: number;
  rowsUsed: number;
  quotaUnitsUsed: number;
  creditsUsed: number;
  updatedAt: string | null;
}

export interface MarketAssetsCatalogFileStatus {
  exists: boolean;
  path: string;
  version: string | null;
  fetchedAt: string | null;
  requestedLimit: number;
  providerTotal: number;
  rawAssetCount: number;
  validAssetCount: number;
  skippedAssetCount: number;
  completionReason: MarketAssetsCompletionReason | null;
}

export interface IMarketAssetsCatalogStore {
  readCatalog(): Promise<MarketAssetsCatalogSnapshot | null>;
  writeCatalog(snapshot: MarketAssetsCatalogSnapshot): Promise<void>;
  readCheckpoint(): Promise<MarketAssetsCollectionCheckpoint | null>;
  writeCheckpoint(checkpoint: MarketAssetsCollectionCheckpoint): Promise<void>;
  deleteCheckpoint(): Promise<void>;
  getStatus(): Promise<MarketAssetsCatalogFileStatus>;
  getCheckpointStatus(): Promise<MarketAssetsCheckpointFileStatus>;
}
