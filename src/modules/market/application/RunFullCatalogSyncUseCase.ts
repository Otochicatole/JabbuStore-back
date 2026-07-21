import { config } from "../../../shared/config";
import type { IMarketSyncStateRepository } from "../domain/IMarketSyncStateRepository";
import { MARKET_ASSETS_SYNC_STATE_KEY } from "./GetMarketSyncStatusUseCase";
import {
  RefreshMarketAssetsCatalogUseCase,
  type RefreshMarketAssetsResult,
} from "./RefreshMarketAssetsCatalogUseCase";
import { marketSyncProgressService } from "./MarketSyncProgressService";
import { syncExecutionCoordinator } from "./SyncExecutionCoordinator";

/**
 * Resultado del job de assets. El nombre de la clase se conserva para no
 * romper imports operativos, pero ya no incluye refresh de precios ni bots.
 */
export type FullCatalogSyncResult = RefreshMarketAssetsResult;

export type FullCatalogSyncStartResult =
  | {
      started: true;
      execution: Promise<FullCatalogSyncResult>;
      blockingReason: null;
    }
  | {
      started: false;
      execution: Promise<FullCatalogSyncResult> | null;
      blockingReason: "market_assets" | "bot_only";
    };

export class SyncExecutionBusyError extends Error {
  constructor(readonly blockingReason: "market_assets" | "bot_only") {
    super(
      blockingReason === "bot_only"
        ? "Hay una sincronización de bots en curso."
        : "Ya hay una sincronización de assets en curso.",
    );
    this.name = "SyncExecutionBusyError";
  }
}

export class RunFullCatalogSyncUseCase {
  private static activeExecution: Promise<FullCatalogSyncResult> | null = null;

  constructor(
    private refreshMarketAssetsCatalog: RefreshMarketAssetsCatalogUseCase,
    private syncStateRepository: IMarketSyncStateRepository,
  ) {}

  isRunning(): boolean {
    return RunFullCatalogSyncUseCase.activeExecution !== null;
  }

  tryStart(triggeredBy: string): FullCatalogSyncStartResult {
    const active = RunFullCatalogSyncUseCase.activeExecution;
    if (active) {
      return {
        started: false,
        execution: active,
        blockingReason: "market_assets",
      };
    }

    const lease = syncExecutionCoordinator.tryAcquire("market_assets");
    if (!lease) {
      return {
        started: false,
        execution: null,
        blockingReason:
          syncExecutionCoordinator.getBlockingKind("market_assets") ??
          "market_assets",
      };
    }

    const execution = this.executeExclusive(triggeredBy);
    RunFullCatalogSyncUseCase.activeExecution = execution;
    const clear = () => {
      if (RunFullCatalogSyncUseCase.activeExecution === execution) {
        RunFullCatalogSyncUseCase.activeExecution = null;
      }
      lease.release();
    };
    void execution.then(clear, clear);
    return { started: true, execution, blockingReason: null };
  }

  async execute(triggeredBy: string): Promise<FullCatalogSyncResult> {
    const start = this.tryStart(triggeredBy);
    if (!start.execution) {
      throw new SyncExecutionBusyError(
        start.blockingReason ?? "market_assets",
      );
    }
    return start.execution;
  }

  private async executeExclusive(triggeredBy: string): Promise<FullCatalogSyncResult> {
    marketSyncProgressService.startSync(
      config.marketAssetsCatalog.target,
      config.marketAssetsCatalog.assetsPerItem,
      triggeredBy,
    );

    try {
      let marketResult = await this.refreshMarketAssetsCatalog.recoverPending();

      if (!marketResult) {
        await this.syncStateRepository.markStarted(
          MARKET_ASSETS_SYNC_STATE_KEY,
          undefined,
          0,
          {
            phase: "building_priority_queue",
            targetAssets: config.marketAssetsCatalog.target,
            assetsPerItem: config.marketAssetsCatalog.assetsPerItem,
            quotaLimit: config.floatSync.maxRowsPerMinute,
          },
        );
        marketResult = await this.refreshMarketAssetsCatalog.execute();
      }

      await this.syncStateRepository.markFullSuccess(
        MARKET_ASSETS_SYNC_STATE_KEY,
      );
      marketSyncProgressService.completeSync(
        marketResult.listings,
        marketResult.floats,
        marketResult.completionReason,
      );
      return marketResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.syncStateRepository
        .markFailed(MARKET_ASSETS_SYNC_STATE_KEY, message)
        .catch(() => undefined);
      marketSyncProgressService.failSync(message);
      throw error;
    }
  }
}
