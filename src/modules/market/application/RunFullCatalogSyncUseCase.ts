import { config } from "../../../shared/config";
import type { IMarketSyncStateRepository } from "../domain/IMarketSyncStateRepository";
import { MARKET_ASSETS_SYNC_STATE_KEY } from "./GetMarketSyncStatusUseCase";
import {
  RefreshMarketAssetsCatalogUseCase,
  type RefreshMarketAssetsResult,
} from "./RefreshMarketAssetsCatalogUseCase";
import { marketSyncProgressService } from "./MarketSyncProgressService";
import { syncExecutionCoordinator } from "./SyncExecutionCoordinator";
import type { IMarketSyncRunRepository } from "../domain/MarketSyncRun";
import { MarketAssetsApiError } from "./IMarketAssetsCatalogClient";
import { MarketAssetsSyncCancelledError } from "./CollectMarketAssetsCatalogUseCase";
import { marketAssetsShutdownCoordinator } from "./MarketAssetsShutdownCoordinator";

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

export type FullCatalogSyncCancelResult =
  | {
      accepted: true;
      alreadyRequested: boolean;
      completion: Promise<void>;
      blockingReason: null;
    }
  | {
      accepted: false;
      alreadyRequested: false;
      completion: null;
      blockingReason: "not_running" | "not_cancellable";
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

export class MarketAssetsCancellationPersistenceError extends Error {
  constructor(readonly persistenceErrors: readonly unknown[]) {
    super(
      "La recolección se detuvo, pero no se pudo guardar el estado durable de cancelación. El checkpoint se conserva como recuperable y no se publicó un snapshot parcial.",
    );
    this.name = "MarketAssetsCancellationPersistenceError";
  }
}

export class RunFullCatalogSyncUseCase {
  private static activeExecution: Promise<FullCatalogSyncResult> | null = null;

  constructor(
    private refreshMarketAssetsCatalog: RefreshMarketAssetsCatalogUseCase,
    private syncStateRepository: IMarketSyncStateRepository,
    private syncRunRepository?: IMarketSyncRunRepository,
  ) {}

  isRunning(): boolean {
    return RunFullCatalogSyncUseCase.activeExecution !== null;
  }

  tryCancel(): FullCatalogSyncCancelResult {
    const active = RunFullCatalogSyncUseCase.activeExecution;
    if (!active) {
      return {
        accepted: false,
        alreadyRequested: false,
        completion: null,
        blockingReason: "not_running",
      };
    }

    const cancellation = marketAssetsShutdownCoordinator.requestCancellation();
    if (!cancellation.accepted) {
      return {
        accepted: false,
        alreadyRequested: false,
        completion: null,
        blockingReason: "not_cancellable",
      };
    }

    return {
      accepted: true,
      alreadyRequested: cancellation.alreadyRequested,
      completion: active.then(
        () => undefined,
        (error) => {
          if (error instanceof MarketAssetsSyncCancelledError) return;
          throw error;
        },
      ),
      blockingReason: null,
    };
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
    const recoveryRequested = await this.hasPendingRecovery();
    let stopHeartbeat: () => void = () => undefined;
    if (this.syncRunRepository) {
      await this.syncRunRepository.startAttempt({
        stateKey: MARKET_ASSETS_SYNC_STATE_KEY,
        triggeredBy,
        phase: "building_priority_queue",
        targetAssets: config.marketAssetsCatalog.target,
        assetsPerItem: config.marketAssetsCatalog.assetsPerItem,
        configuredConcurrency: config.marketAssetsCatalog.concurrency,
        initialConcurrency:
          config.marketAssetsCatalog.forceMaxConcurrency
            ? config.marketAssetsCatalog.concurrency
            : config.marketAssetsCatalog.initialConcurrency,
        recoveryRequested,
        recoveryKind: recoveryRequested ? "pending" : "none",
      });
      stopHeartbeat = this.startHeartbeat();
    }
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

      // Cerrar primero la corrida. Si esta transacción falla, lastSuccessfulAt
      // aún queda anterior a lastPublishedAt y recoverPending reintenta sólo la
      // finalización sin volver a descargar assets. Hacerlo al revés podía dejar
      // snapshot exitoso + run activo imposible de reconciliar.
      await this.syncRunRepository?.complete(MARKET_ASSETS_SYNC_STATE_KEY, {
        completionReason: marketResult.completionReason,
      });
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
      if (error instanceof MarketAssetsSyncCancelledError) {
        try {
          await this.persistCancellation(message);
        } catch (persistenceError) {
          const persistenceMessage =
            persistenceError instanceof Error
              ? persistenceError.message
              : String(persistenceError);
          marketSyncProgressService.failSync(persistenceMessage, true);
          throw persistenceError;
        }
        marketSyncProgressService.cancelSync(message);
        throw error;
      }
      const fatalProviderError =
        error instanceof MarketAssetsApiError && error.kind === "fatal";
      // El checkpoint se conserva para una reanudación manual o el próximo
      // ciclo, pero 401/402/403 no deben quedar marcados como auto-recuperables.
      let resumable = false;
      if (!fatalProviderError) {
        try {
          resumable = await this.hasPendingRecovery();
        } catch {
          // Si el catálogo desapareció mientras corría el pipeline, conservar
          // el checkpoint como recuperable y no ocultar el error original.
          resumable = true;
        }
      }
      await (resumable
        ? this.syncStateRepository.markFailed(
            MARKET_ASSETS_SYNC_STATE_KEY,
            message,
            true,
          )
        : this.syncStateRepository.markFailed(
            MARKET_ASSETS_SYNC_STATE_KEY,
            message,
          )
      ).catch(() => undefined);
      await this.syncRunRepository
        ?.finishAttempt(MARKET_ASSETS_SYNC_STATE_KEY, {
          error: message,
          resumable,
        })
        .catch(() => undefined);
      marketSyncProgressService.failSync(message, resumable);
      throw error;
    } finally {
      stopHeartbeat();
    }
  }

  private startHeartbeat(): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (stopped || !this.syncRunRepository) return;
      timer = setTimeout(async () => {
        try {
          await this.syncRunRepository?.heartbeat(MARKET_ASSETS_SYNC_STATE_KEY);
        } catch (error) {
          console.error(
            "[Market Assets Sync] No se pudo persistir el heartbeat:",
            error,
          );
        } finally {
          schedule();
        }
      }, 5_000);
      timer.unref?.();
    };
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  private async hasPendingRecovery(): Promise<boolean> {
    if (
      typeof this.refreshMarketAssetsCatalog.hasPendingRecovery !== "function"
    ) {
      return false;
    }
    return this.refreshMarketAssetsCatalog.hasPendingRecovery();
  }

  private async persistCancellation(message: string): Promise<void> {
    let runPersisted = false;
    let statePersisted = false;
    const errors: unknown[] = [];

    // Dos escrituras independientes dan una ruta de respaldo. cancel() cierra
    // run + state transaccionalmente; markCancelled() deja al menos la fase
    // terminal durable aunque el cierre detallado del run falle.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!runPersisted && this.syncRunRepository) {
        try {
          runPersisted = await this.syncRunRepository.cancel(
            MARKET_ASSETS_SYNC_STATE_KEY,
            message,
          );
          if (!runPersisted) {
            errors.push(
              new Error(
                "No existía una corrida durable activa para cerrar.",
              ),
            );
          }
        } catch (error) {
          errors.push(error);
        }
      }
      if (!statePersisted) {
        try {
          await this.syncStateRepository.markCancelled(
            MARKET_ASSETS_SYNC_STATE_KEY,
            message,
          );
          statePersisted = true;
        } catch (error) {
          errors.push(error);
        }
      }
      if (
        statePersisted &&
        (runPersisted || this.syncRunRepository == null)
      ) {
        return;
      }
      await Promise.resolve();
    }

    // Cualquiera de las dos rutas deja una marca durable suficiente para que
    // status/scheduler no finjan que la cancelación nunca ocurrió.
    if (runPersisted || statePersisted) return;
    throw new MarketAssetsCancellationPersistenceError(errors);
  }
}
