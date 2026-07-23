export const MARKET_ASSETS_CATALOG_SCHEMA_VERSION = 1 as const;
export const MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION = 4 as const;
export const MARKET_ASSETS_MAX_WORKER_CONCURRENCY = 48 as const;
export const MARKET_ASSETS_MAX_HEALTH_SAMPLES = 100 as const;

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
  /** Tamaño elegido para la primera página; 0 hasta resolver el hint. */
  initialLimit: number;
  offset: number;
  validAssetCount: number;
  rawAssetCount: number;
  skippedAssetCount: number;
  quotaUnitsUsed: number;
  creditsUsed: number;
  providerTotal: number;
  consecutiveFailures: number;
  pageRequests: number;
  httpAttempts: number;
  deferredRecoveryAttempts: number;
  completed: boolean;
  exhausted: boolean;
  lastError: string | null;
}

export type MarketAssetsWorkerHealthOutcome =
  | "success"
  | "candidate_error"
  | "timeout"
  | "network_error"
  | "server_error"
  | "rate_limited";

export interface MarketAssetsWorkerHealthSample {
  recordedAt: string;
  latencyMs: number;
  assetsCollected: number;
  outcome: MarketAssetsWorkerHealthOutcome;
}

export type MarketAssetsCircuitBreakerState =
  | "closed"
  | "open"
  | "half_open";

export interface MarketAssetsCircuitBreakerCheckpoint {
  state: MarketAssetsCircuitBreakerState;
  openCount: number;
  /** Instante de prueba half-open; `null` cuando no hay pausa activa. */
  resumeAt: string | null;
}

export interface MarketAssetsCollectionCheckpoint {
  schemaVersion: typeof MARKET_ASSETS_CHECKPOINT_SCHEMA_VERSION;
  runId: string | null;
  queueVersion: string;
  targetAssets: number;
  assetsPerItem: number;
  sort: MarketAssetsCatalogSort;
  /** Techo configurado de workers simultáneos. */
  concurrency: number;
  /** Concurrencia con la que comienza una corrida nueva. */
  initialConcurrency: number;
  /** Estado adaptativo durable; nunca supera `concurrency` ni 48. */
  effectiveConcurrency: number;
  /** Índice actual dentro de la rampa 6 → 9 → 14 → 21 → 32 → 48. */
  rampStage: number;
  /** Baseline obtenido de las primeras respuestas sanas. */
  latencyBaselineMs: number | null;
  /** Ventana durable y acotada usada para decidir escalado/reducción. */
  recentHealthSamples: MarketAssetsWorkerHealthSample[];
  /** Evita volver a escalar durante el cooldown posterior a una reducción. */
  concurrencyCooldownUntil: string | null;
  consecutiveCongestionFailures: number;
  circuitBreaker: MarketAssetsCircuitBreakerCheckpoint;
  targetDurationSeconds: number;
  targetDeadlineAt: string;
  tenMinuteTargetUnreachable: boolean;
  /** @deprecated Estado AIMD v3 conservado durante la transición. */
  successfulBatchesSinceReduction: number;
  /** @deprecated Estado AIMD v3 conservado durante la transición. */
  adaptiveFailureRounds: number;
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
  /** Controlador v4 durable; ausente cuando todavía no existe checkpoint. */
  concurrency?: number;
  initialConcurrency?: number;
  effectiveConcurrency?: number;
  circuitBreaker?: MarketAssetsCircuitBreakerCheckpoint;
  targetDurationSeconds?: number;
  targetDeadlineAt?: string | null;
  tenMinuteTargetUnreachable?: boolean;
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
