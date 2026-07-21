import type { BotPriceCatalogStatus } from "../domain/types";
import { SteamWebApiItemsCatalogClient } from "../infrastructure/SteamWebApiItemsCatalogClient";
import { SteamWebApiItemsCatalogStore } from "../infrastructure/SteamWebApiItemsCatalogStore";

export interface ItemsCatalogRefreshOptions {
  triggeredBy: "manual" | "scheduler" | string;
  onProgress?: (progress: {
    currentPage: number;
    totalPages: number;
    itemCount: number;
  }) => void;
}

export interface ItemsCatalogRefreshStartResult {
  started: boolean;
  /** Promesa single-flight compartida por API y scheduler. */
  execution: Promise<BotPriceCatalogStatus>;
}

interface RuntimeStatus {
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastItemCount: number | null;
  triggeredBy: string | null;
  currentPage: number;
  currentItemCount: number;
  totalPages: number;
}

const runtimeStatus: RuntimeStatus = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastItemCount: null,
  triggeredBy: null,
  currentPage: 0,
  currentItemCount: 0,
  totalPages: 0,
};

export class ItemsCatalogRefreshService {
  private static activeExecution: Promise<BotPriceCatalogStatus> | null = null;

  constructor(
    private client = new SteamWebApiItemsCatalogClient(),
    private store = new SteamWebApiItemsCatalogStore(),
  ) {}

  async getStatus(): Promise<BotPriceCatalogStatus> {
    const persisted = await this.store.getStatus();
    return {
      ...persisted,
      running: runtimeStatus.running,
      lastStartedAt: runtimeStatus.lastStartedAt,
      lastFinishedAt: runtimeStatus.lastFinishedAt,
      lastItemCount: runtimeStatus.lastItemCount,
      triggeredBy: runtimeStatus.triggeredBy,
      currentPage: runtimeStatus.currentPage,
      currentItemCount: runtimeStatus.currentItemCount,
      totalPages: runtimeStatus.totalPages,
      ...(runtimeStatus.lastError ? { lastError: runtimeStatus.lastError } : {}),
    };
  }

  async refreshNow(options: ItemsCatalogRefreshOptions): Promise<BotPriceCatalogStatus> {
    return this.tryStart(options).execution;
  }

  tryStart(options: ItemsCatalogRefreshOptions): ItemsCatalogRefreshStartResult {
    const active = ItemsCatalogRefreshService.activeExecution;
    if (active) return { started: false, execution: active };

    const execution = this.refreshExclusive(options);
    ItemsCatalogRefreshService.activeExecution = execution;
    const clear = () => {
      if (ItemsCatalogRefreshService.activeExecution === execution) {
        ItemsCatalogRefreshService.activeExecution = null;
      }
    };
    void execution.then(clear, clear);
    return { started: true, execution };
  }

  isRunning(): boolean {
    return ItemsCatalogRefreshService.activeExecution !== null;
  }

  private async refreshExclusive(
    options: ItemsCatalogRefreshOptions,
  ): Promise<BotPriceCatalogStatus> {

    runtimeStatus.running = true;
    runtimeStatus.triggeredBy = options.triggeredBy;
    runtimeStatus.lastStartedAt = new Date().toISOString();
    runtimeStatus.lastFinishedAt = null;
    runtimeStatus.lastError = null;
    runtimeStatus.currentPage = 0;
    runtimeStatus.currentItemCount = 0;
    runtimeStatus.totalPages = 0;

    try {
      console.log(
        `[Items Catalog Refresh] Iniciando descarga (${options.triggeredBy})...`,
      );
      const result = await this.client.fetchCatalog({
        forceRefresh: true,
        onProgress: (progress) => {
          runtimeStatus.currentPage = progress.currentPage;
          runtimeStatus.currentItemCount = progress.itemCount;
          runtimeStatus.totalPages = progress.totalPages;
          options.onProgress?.(progress);
        },
      });

      if (!result.ok || !result.snapshot || result.errors.length > 0) {
        throw new Error(
          result.errors.join("; ") || "No se recibió un catálogo completo",
        );
      }

      await this.store.writeCatalog(result.snapshot);
      runtimeStatus.lastItemCount = result.snapshot.itemCount;
      console.log(
        `[Items Catalog Refresh] Catálogo actualizado: ${result.snapshot.itemCount} items (${result.snapshot.pageCount} páginas).`,
      );
    } catch (error: any) {
      runtimeStatus.lastError = error?.message || String(error);
      console.error("[Items Catalog Refresh] Error inesperado:", error);
      throw error;
    } finally {
      runtimeStatus.running = false;
      runtimeStatus.lastFinishedAt = new Date().toISOString();
    }

    // El resultado observable pertenece al job completo: nunca resolver la
    // promesa de refresh con running=true sólo porque el archivo ya se escribió.
    return this.getStatus();
  }

  async startRefreshInBackground(
    options: ItemsCatalogRefreshOptions,
  ): Promise<{ started: boolean; status: BotPriceCatalogStatus }> {
    const start = this.tryStart(options);
    if (start.started) void start.execution.catch((error) => {
      runtimeStatus.lastError = error?.message || String(error);
      runtimeStatus.running = false;
      runtimeStatus.lastFinishedAt = new Date().toISOString();
      console.error("[Items Catalog Refresh] Background error:", error);
    });

    return { started: start.started, status: await this.getStatus() };
  }
}

export const itemsCatalogRefreshService = new ItemsCatalogRefreshService();
