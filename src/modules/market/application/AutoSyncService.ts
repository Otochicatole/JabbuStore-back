import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { itemsCatalogRefreshService } from "../../pricing/application/ItemsCatalogRefreshService";
import { GenerateCatalogGlobalUseCase } from "./GenerateCatalogGlobalUseCase";
import type { CatalogFilters } from "./GenerateCatalogGlobalUseCase";
import { SyncStoreItemsUseCase } from "../../store/application/SyncStoreItemsUseCase";
import { PrismaStoreRepository } from "../../store/infrastructure/PrismaStoreRepository";

export type AutoSyncStep = "idle" | "step1_downloading" | "step2_generating" | "step3_syncing";

export interface AutoSyncStatus {
  running: boolean;
  enabled: boolean;
  intervalMinutes: number;
  currentStep: AutoSyncStep;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  lastStep1ItemCount: number | null;
  lastStep2ItemCount: number | null;
}

class AutoSyncService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generateCatalogGlobalUseCase = new GenerateCatalogGlobalUseCase();
  private syncStoreItemsUseCase = new SyncStoreItemsUseCase(new PrismaStoreRepository());

  private _status: AutoSyncStatus = {
    running: false,
    enabled: false,
    intervalMinutes: 5,
    currentStep: "idle",
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    lastStep1ItemCount: null,
    lastStep2ItemCount: null,
  };

  get status(): AutoSyncStatus {
    return { ...this._status };
  }

  async loadSettings(): Promise<void> {
    try {
      const settings = await prisma.adminSettings.findFirst();
      this._status.enabled = settings?.autoSyncEnabled ?? false;
      this._status.intervalMinutes = settings?.autoSyncIntervalMinutes ?? 5;
    } catch (err) {
      console.error("[AutoSync] Error loading settings:", err);
    }
  }

  async start(): Promise<void> {
    await this.loadSettings();
    if (!this._status.enabled) {
      console.log("[AutoSync] Auto sync disabled, not starting.");
      return;
    }
    console.log(`[AutoSync] Starting auto sync every ${this._status.intervalMinutes} minutes.`);
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this._status.running = false;
    this._status.currentStep = "idle";
    this._status.nextRunAt = null;
    console.log("[AutoSync] Stopped.");
  }

  async restart(): Promise<void> {
    this.stop();
    await this.loadSettings();
    if (this._status.enabled) {
      console.log(`[AutoSync] Restarting with interval ${this._status.intervalMinutes} minutes.`);
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this._status.enabled) return;

    const ms = this._status.intervalMinutes * 60 * 1000;
    this._status.nextRunAt = new Date(Date.now() + ms).toISOString();

    this.timer = setTimeout(() => {
      void this.runCycle();
    }, ms);
  }

  private async runCycle(): Promise<void> {
    if (this._status.running) {
      console.log("[AutoSync] Cycle already running, skipping.");
      this.scheduleNext();
      return;
    }

    this._status.running = true;
    this._status.lastError = null;
    console.log("[AutoSync] Starting sync cycle...");

    try {
      await this.step1Download();
      await this.step2Generate();
      await this.step3SyncPrices();
      this._status.lastRunAt = new Date().toISOString();
      console.log("[AutoSync] Cycle completed successfully.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._status.lastError = msg;
      console.error("[AutoSync] Cycle failed:", msg);
    } finally {
      this._status.running = false;
      this._status.currentStep = "idle";
      this.scheduleNext();
    }
  }

  private async step1Download(): Promise<void> {
    this._status.currentStep = "step1_downloading";
    console.log("[AutoSync] Step 1: Downloading items-catalog.json...");
    const status = await itemsCatalogRefreshService.refreshNow({ triggeredBy: "auto-sync" });
    this._status.lastStep1ItemCount = status.lastItemCount ?? null;
    console.log(`[AutoSync] Step 1 done: ${status.lastItemCount ?? 0} items.`);
  }

  private async step2Generate(): Promise<void> {
    this._status.currentStep = "step2_generating";
    console.log("[AutoSync] Step 2: Generating catalog-global.json...");

    const adminSettings = await prisma.adminSettings.findFirst();
    const filters: CatalogFilters | undefined = adminSettings
      ? {
          catalogFilterKnivesEnabled: adminSettings.catalogFilterKnivesEnabled,
          catalogFilterGlovesEnabled: adminSettings.catalogFilterGlovesEnabled,
          catalogFilterRiflesEnabled: adminSettings.catalogFilterRiflesEnabled,
          catalogFilterPistolsEnabled: adminSettings.catalogFilterPistolsEnabled,
          catalogFilterSMGsEnabled: adminSettings.catalogFilterSMGsEnabled,
          catalogFilterHeavyEnabled: adminSettings.catalogFilterHeavyEnabled,
          catalogFilterSouvenirEnabled: adminSettings.catalogFilterSouvenirEnabled,
          catalogFilterStatTrakEnabled: adminSettings.catalogFilterStatTrakEnabled,
          catalogMinPrice: adminSettings.catalogMinPrice,
        }
      : undefined;

    const result = await this.generateCatalogGlobalUseCase.execute(filters);
    this._status.lastStep2ItemCount = result.matchedItemsCount;
    console.log(`[AutoSync] Step 2 done: ${result.matchedItemsCount} items.`);
  }

  private async step3SyncPrices(): Promise<void> {
    this._status.currentStep = "step3_syncing";
    console.log("[AutoSync] Step 3: Syncing bot inventory + prices...");
    const result = await this.syncStoreItemsUseCase.execute();
    console.log(`[AutoSync] Step 3 done: ${result.message}`);
  }

  async runNow(): Promise<void> {
    if (this._status.running) {
      throw new Error("A sync cycle is already running.");
    }
    this.stop();
    void this.runCycle();
  }
}

export const autoSyncService = new AutoSyncService();
