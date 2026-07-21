import type { MarketSyncRunStatusView } from "../domain/MarketSyncRun";

export type MarketSyncPhase =
  | "idle"
  | "refreshing_items_catalog"
  | "building_priority_queue"
  | "collecting_assets"
  | "waiting_rate_limit"
  | "validating_snapshot"
  | "saving_snapshot"
  | "publishing_database"
  | "syncing_bots"
  | "paused"
  | "completed"
  | "failed";

export type MarketSyncCompletionReason =
  | "target_reached"
  | "catalog_exhausted";

export interface LastPublishedMarketSnapshotStatus {
  snapshotHash: string;
  rawAssets: number;
  validAssets: number;
  skippedAssets: number;
  publishedListings: number;
  publishedFloats: number;
  publishedAt: string | null;
  successfulAt: string | null;
  completionReason: MarketSyncCompletionReason | null;
}

export interface MarketSyncStatus {
  running: boolean;
  resumable: boolean;
  phase: MarketSyncPhase;
  triggeredBy: string | null;
  targetAssets: number;
  assetsPerItem: number;
  rawAssets: number;
  validAssets: number;
  skippedAssets: number;
  totalCandidates: number;
  candidatesVisited: number;
  currentCandidate: string | null;
  quotaUnitsUsed: number;
  creditsUsed: number;
  quotaLimit: number;
  quotaResetsAt: string | null;
  listingsProcessed: number;
  totalListings: number;
  floatsIndexed: number;
  publishedListings: number;
  publishedFloats: number;
  lastPublished: LastPublishedMarketSnapshotStatus | null;
  snapshotHash: string | null;
  snapshotFetchedAt: string | null;
  completionReason: MarketSyncCompletionReason | null;
  itemsCatalog: {
    fetchedAt: string | null;
    itemCount: number;
    currentPage: number;
    totalPages: number;
    running: boolean;
  } | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSuccessfulAt: string | null;
  lastError: string | null;
  message: string | null;
  /** Telemetria durable de la corrida activa o de la ultima corrida terminal. */
  run: MarketSyncRunStatusView | null;
  /** Alias temporales consumidos por clientes anteriores. */
  requestedAssets: number;
  rowsUsed: number;
  rateLimitResetsAt: string | null;
  currentPage: number;
  maxPages: number;
}

class MarketSyncProgressService {
  private status: MarketSyncStatus = this.createIdleStatus();

  private createIdleStatus(): MarketSyncStatus {
    return {
      running: false,
      resumable: false,
      phase: "idle",
      triggeredBy: null,
      targetAssets: 0,
      assetsPerItem: 10,
      rawAssets: 0,
      validAssets: 0,
      skippedAssets: 0,
      totalCandidates: 0,
      candidatesVisited: 0,
      currentCandidate: null,
      quotaUnitsUsed: 0,
      creditsUsed: 0,
      quotaLimit: 10_000,
      quotaResetsAt: null,
      listingsProcessed: 0,
      totalListings: 0,
      floatsIndexed: 0,
      publishedListings: 0,
      publishedFloats: 0,
      lastPublished: null,
      snapshotHash: null,
      snapshotFetchedAt: null,
      completionReason: null,
      itemsCatalog: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      message: null,
      run: null,
      requestedAssets: 0,
      rowsUsed: 0,
      rateLimitResetsAt: null,
      currentPage: 0,
      maxPages: 0,
    };
  }

  getStatus(): MarketSyncStatus {
    return {
      ...this.status,
      itemsCatalog: this.status.itemsCatalog
        ? { ...this.status.itemsCatalog }
        : null,
    };
  }

  startSync(
    targetAssets: number,
    assetsPerItemOrTriggeredBy: number | string = "unknown",
    maybeTriggeredBy?: string,
  ): void {
    const assetsPerItem =
      typeof assetsPerItemOrTriggeredBy === "number"
        ? assetsPerItemOrTriggeredBy
        : 10;
    const triggeredBy =
      typeof assetsPerItemOrTriggeredBy === "string"
        ? assetsPerItemOrTriggeredBy
        : maybeTriggeredBy ?? "unknown";
    this.status = {
      ...this.createIdleStatus(),
      running: true,
      phase: "building_priority_queue",
      triggeredBy,
      targetAssets,
      assetsPerItem,
      requestedAssets: targetAssets,
      lastStartedAt: new Date().toISOString(),
      message: "Preparando la sincronización atómica del catálogo...",
    };
  }

  /** Compatibilidad con el sincronizador incremental mientras se retira del bootstrap. */
  updateFetchPage(page: number, assetsCount: number): void {
    this.status.currentPage = page;
    this.status.candidatesVisited = page;
    this.status.rawAssets = assetsCount;
  }

  startItemsCatalogRefresh(): void {
    this.status.phase = "refreshing_items_catalog";
    this.status.itemsCatalog = {
      fetchedAt: this.status.itemsCatalog?.fetchedAt ?? null,
      itemCount: 0,
      currentPage: 0,
      totalPages: 0,
      running: true,
    };
    this.status.message = "Descargando y validando items-catalog.json...";
  }

  updateItemsCatalogProgress(input: {
    currentPage: number;
    totalPages: number;
    itemCount: number;
  }): void {
    this.status.itemsCatalog = {
      fetchedAt: this.status.itemsCatalog?.fetchedAt ?? null,
      itemCount: input.itemCount,
      currentPage: input.currentPage,
      totalPages: input.totalPages,
      running: true,
    };
    this.status.message = `Descargando items-catalog.json: página ${input.currentPage.toLocaleString("es-AR")}, ${input.itemCount.toLocaleString("es-AR")} items.`;
  }

  setItemsCatalog(input: {
    fetchedAt: string | null;
    itemCount: number;
    pageCount?: number;
  }): void {
    this.status.itemsCatalog = {
      fetchedAt: input.fetchedAt,
      itemCount: input.itemCount,
      currentPage: input.pageCount ?? this.status.itemsCatalog?.currentPage ?? 0,
      totalPages: input.pageCount ?? this.status.itemsCatalog?.totalPages ?? 0,
      running: false,
    };
    this.status.phase = "building_priority_queue";
    this.status.message = "Construyendo cola de skins ordenada por precio...";
  }

  startCollection(input: {
    targetAssets: number;
    assetsPerItem?: number;
    totalCandidates: number;
    candidatesVisited: number;
    rawAssets: number;
    validAssets: number;
    skippedAssets: number;
    rowsUsed?: number;
    quotaUnitsUsed?: number;
    creditsUsed?: number;
    quotaLimit?: number;
  }): void {
    this.status.phase = "collecting_assets";
    this.status.running = true;
    this.status.resumable = false;
    this.status.targetAssets = input.targetAssets;
    this.status.requestedAssets = input.targetAssets;
    this.status.assetsPerItem = input.assetsPerItem ?? this.status.assetsPerItem;
    this.status.totalCandidates = input.totalCandidates;
    this.status.maxPages = input.totalCandidates;
    this.updateCollection({ ...input, currentCandidate: null });
  }

  updateCollection(input: {
    currentCandidate?: string | null;
    candidatesVisited: number;
    rawAssets: number;
    validAssets: number;
    skippedAssets: number;
    rowsUsed?: number;
    quotaUnitsUsed?: number;
    creditsUsed?: number;
    quotaLimit?: number;
  }): void {
    const quotaUsed = input.quotaUnitsUsed ?? input.rowsUsed ?? 0;
    this.status.phase = "collecting_assets";
    this.status.currentCandidate =
      input.currentCandidate === undefined
        ? this.status.currentCandidate
        : input.currentCandidate;
    this.status.candidatesVisited = input.candidatesVisited;
    this.status.currentPage = input.candidatesVisited;
    this.status.rawAssets = input.rawAssets;
    this.status.validAssets = input.validAssets;
    this.status.skippedAssets = input.skippedAssets;
    this.status.quotaUnitsUsed = quotaUsed;
    this.status.rowsUsed = quotaUsed;
    if (input.creditsUsed != null) this.status.creditsUsed = input.creditsUsed;
    if (input.quotaLimit) this.status.quotaLimit = input.quotaLimit;
    this.status.quotaResetsAt = null;
    this.status.rateLimitResetsAt = null;
    this.status.message = `Recolectando assets: ${input.validAssets.toLocaleString("es-AR")}/${this.status.targetAssets.toLocaleString("es-AR")} válidos; skin ${input.candidatesVisited.toLocaleString("es-AR")}/${this.status.totalCandidates.toLocaleString("es-AR")}.`;
  }

  waitForRateLimit(waitMs: number): void {
    const resetAt = new Date(Date.now() + Math.max(0, waitMs)).toISOString();
    this.status.phase = "waiting_rate_limit";
    this.status.quotaResetsAt = resetAt;
    this.status.rateLimitResetsAt = resetAt;
    this.status.resumable = true;
    this.status.message = "Cuota consumida; la recolección continuará en la próxima ventana.";
  }

  pause(message: string): void {
    this.status.running = false;
    this.status.resumable = true;
    this.status.phase = "paused";
    this.status.message = message;
    this.status.lastFinishedAt = new Date().toISOString();
  }

  startSnapshotValidation(rawAssets: number): void {
    this.status.phase = "validating_snapshot";
    this.status.rawAssets = rawAssets;
    this.status.quotaResetsAt = null;
    this.status.rateLimitResetsAt = null;
    this.status.message = `Validando ${rawAssets.toLocaleString("es-AR")} assets descargados...`;
  }

  snapshotValidated(input: {
    validAssets: number;
    skippedAssets: number;
    snapshotHash: string;
    fetchedAt: string;
    completionReason?: MarketSyncCompletionReason;
  }): void {
    this.status.phase = "saving_snapshot";
    this.status.validAssets = input.validAssets;
    this.status.skippedAssets = input.skippedAssets;
    this.status.snapshotHash = input.snapshotHash;
    this.status.snapshotFetchedAt = input.fetchedAt;
    this.status.completionReason = input.completionReason ?? null;
    this.status.message = "Guardando snapshot validado de forma atómica...";
  }

  startDatabaseSave(totalListings: number): void {
    this.status.phase = "publishing_database";
    this.status.totalListings = totalListings;
    this.status.listingsProcessed = 0;
    this.status.message = `Publicando ${totalListings.toLocaleString("es-AR")} listings en una transacción...`;
  }

  updateDatabaseProgress(processed: number): void {
    this.status.listingsProcessed = processed;
  }

  startSyncingBots(): void {
    this.status.phase = "syncing_bots";
    this.status.message = "Actualizando inventario y precios de los bots...";
  }

  completeSync(
    listingsCount: number,
    floatsCount: number,
    completionReason: MarketSyncCompletionReason =
      this.status.completionReason ?? "target_reached",
  ): void {
    this.status.running = false;
    this.status.resumable = false;
    this.status.phase = "completed";
    this.status.listingsProcessed = listingsCount;
    this.status.totalListings = listingsCount;
    this.status.floatsIndexed = floatsCount;
    this.status.publishedListings = listingsCount;
    this.status.publishedFloats = floatsCount;
    this.status.completionReason = completionReason;
    this.status.lastFinishedAt = new Date().toISOString();
    this.status.lastSuccessfulAt = this.status.lastFinishedAt;
    this.status.lastError = null;
    this.status.message = `Sincronización completa: ${listingsCount.toLocaleString("es-AR")} listings y ${floatsCount.toLocaleString("es-AR")} assets publicados.`;
  }

  failSync(error: string, resumable = false): void {
    this.status.running = false;
    this.status.resumable = resumable;
    this.status.phase = resumable ? "paused" : "failed";
    this.status.lastError = error;
    this.status.lastFinishedAt = new Date().toISOString();
    this.status.message = `Error en sincronización: ${error}`;
  }
}

export const marketSyncProgressService = new MarketSyncProgressService();
