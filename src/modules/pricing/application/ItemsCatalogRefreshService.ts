import type { BotPriceCatalogStatus } from "../domain/types";
import { SteamWebApiItemsCatalogClient } from "../infrastructure/SteamWebApiItemsCatalogClient";
import { SteamWebApiItemsCatalogStore } from "../infrastructure/SteamWebApiItemsCatalogStore";

export interface ItemsCatalogRefreshOptions {
  triggeredBy: "manual" | "scheduler" | string;
}

interface RuntimeStatus {
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastItemCount: number | null;
  triggeredBy: string | null;
}

const runtimeStatus: RuntimeStatus = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastItemCount: null,
  triggeredBy: null,
};

export class ItemsCatalogRefreshService {
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
      ...(runtimeStatus.lastError ? { lastError: runtimeStatus.lastError } : {}),
    };
  }

  async refreshNow(options: ItemsCatalogRefreshOptions): Promise<BotPriceCatalogStatus> {
    if (runtimeStatus.running) {
      return this.getStatus();
    }

    runtimeStatus.running = true;
    runtimeStatus.triggeredBy = options.triggeredBy;
    runtimeStatus.lastStartedAt = new Date().toISOString();
    runtimeStatus.lastFinishedAt = null;
    runtimeStatus.lastError = null;

    try {
      console.log(
        `[Items Catalog Refresh] Iniciando descarga (${options.triggeredBy})...`,
      );
      const result = await this.client.fetchCatalog({ forceRefresh: true });

      if (!result.snapshot) {
        const error = result.errors.join("; ") || "No se recibió snapshot del catálogo";
        runtimeStatus.lastError = error;
        console.error(`[Items Catalog Refresh] Falló: ${error}`);
        return this.getStatus();
      }

      await this.store.writeCatalog(result.snapshot);
      runtimeStatus.lastItemCount = result.snapshot.itemCount;
      if (result.errors.length > 0) {
        runtimeStatus.lastError = result.errors.join("; ");
      }
      console.log(
        `[Items Catalog Refresh] Catálogo actualizado: ${result.snapshot.itemCount} items (${result.snapshot.pageCount} páginas).`,
      );
      return this.getStatus();
    } catch (error: any) {
      runtimeStatus.lastError = error?.message || String(error);
      console.error("[Items Catalog Refresh] Error inesperado:", error);
      return this.getStatus();
    } finally {
      runtimeStatus.running = false;
      runtimeStatus.lastFinishedAt = new Date().toISOString();
    }
  }

  async startRefreshInBackground(
    options: ItemsCatalogRefreshOptions,
  ): Promise<{ started: boolean; status: BotPriceCatalogStatus }> {
    if (runtimeStatus.running) {
      return { started: false, status: await this.getStatus() };
    }

    void this.refreshNow(options).catch((error) => {
      runtimeStatus.lastError = error?.message || String(error);
      runtimeStatus.running = false;
      runtimeStatus.lastFinishedAt = new Date().toISOString();
      console.error("[Items Catalog Refresh] Background error:", error);
    });

    return { started: true, status: await this.getStatus() };
  }
}

export const itemsCatalogRefreshService = new ItemsCatalogRefreshService();
