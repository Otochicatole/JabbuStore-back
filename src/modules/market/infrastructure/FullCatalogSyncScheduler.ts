import { config } from "../../../shared/config";
import { MarketAssetsApiError } from "../application/IMarketAssetsCatalogClient";
import { MarketAssetsPriorityQueueError } from "../application/MarketAssetsPriorityQueue";
import { SyncExecutionBusyError } from "../application/RunFullCatalogSyncUseCase";
import {
  getMarketSyncStatusUseCase,
  runFullCatalogSyncUseCase,
} from "./MarketSyncDependencies";

const MIN_DELAY_MS = 1_000;
const BUSY_RETRY_MS = 60_000;

export interface FullCatalogSyncSchedulerStatus {
  resumable: boolean;
  snapshotHash: string | null;
  lastSuccessfulAt: string | null;
  quotaResetsAt?: string | null;
}

export interface FullCatalogSyncSchedulerResult {
  snapshotHash: string;
  validAssets: number;
  listings: number;
}

export interface FullCatalogSyncSchedulerDependencies {
  enabled: boolean;
  intervalMinutes: number;
  getStatus(): Promise<FullCatalogSyncSchedulerStatus>;
  execute(): Promise<FullCatalogSyncSchedulerResult>;
  logger?: Pick<Console, "log" | "error">;
}

export interface FullCatalogSyncSchedulerHandle {
  start(): void;
  stop(): void;
}

/**
 * Construye el scheduler assets-only. La inyección mantiene el reloj
 * controlable mediante timers falsos y evita cargar Prisma o clientes HTTP en
 * las pruebas. El nombre del archivo se conserva por compatibilidad operativa.
 */
export function createFullCatalogSyncScheduler(
  dependencies: FullCatalogSyncSchedulerDependencies,
): FullCatalogSyncSchedulerHandle {
  const logger = dependencies.logger ?? console;
  const intervalMs = dependencies.intervalMinutes * 60_000;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let started = false;

  const schedule = (delayMs: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(runAndReschedule, Math.max(MIN_DELAY_MS, delayMs));
  };

  const delayFromStatus = async (): Promise<number> => {
    const status = await dependencies.getStatus();
    if (status.resumable || !status.snapshotHash) return MIN_DELAY_MS;
    const lastSuccessMs = status.lastSuccessfulAt
      ? new Date(status.lastSuccessfulAt).getTime()
      : 0;
    if (!Number.isFinite(lastSuccessMs) || lastSuccessMs <= 0) {
      return MIN_DELAY_MS;
    }
    return Math.max(MIN_DELAY_MS, lastSuccessMs + intervalMs - Date.now());
  };

  const scheduleFromDurableState = async () => {
    const delay = await delayFromStatus();
    logger.log(
      `[Market Assets Scheduler] Próxima ejecución en ${Math.ceil(delay / 60_000)} minuto(s).`,
    );
    schedule(delay);
  };

  const scheduleResumableFailure = async (): Promise<boolean> => {
    const status = await dependencies.getStatus();
    if (!status.resumable) return false;

    const resetAt = status.quotaResetsAt
      ? new Date(status.quotaResetsAt).getTime()
      : Number.NaN;
    const delay =
      Number.isFinite(resetAt) && resetAt > Date.now()
        ? resetAt - Date.now() + MIN_DELAY_MS
        : BUSY_RETRY_MS;
    logger.log(
      `[Market Assets Scheduler] Trabajo recuperable; reanudación en ${Math.ceil(delay / 1_000)} segundo(s).`,
    );
    schedule(delay);
    return true;
  };

  async function runAndReschedule() {
    timer = null;
    if (stopped) return;

    let succeeded = false;
    try {
      // El estado durable puede haber cambiado por una ejecución manual desde
      // que se armó el timer. Se vuelve a calcular antes de ejecutar.
      const delay = await delayFromStatus();
      if (delay > MIN_DELAY_MS) {
        schedule(delay);
        return;
      }
      const result = await dependencies.execute();
      succeeded = true;
      logger.log(
        `[Market Assets Scheduler] Snapshot ${result.snapshotHash.slice(0, 12)}: ${result.validAssets} assets y ${result.listings} listings.`,
      );
    } catch (error) {
      logger.error("[Market Assets Scheduler] Error:", error);
      if (error instanceof SyncExecutionBusyError) {
        schedule(BUSY_RETRY_MS);
      } else if (error instanceof MarketAssetsPriorityQueueError) {
        logger.log(
          `[Market Assets Scheduler] Catálogo local no listo (${error.kind}); se volverá a comprobar en 60 segundos.`,
        );
        schedule(BUSY_RETRY_MS);
      } else if (
        error instanceof MarketAssetsApiError &&
        error.kind === "fatal"
      ) {
        // Credenciales, plan/cuota contractual o un 4xx inválido requieren
        // intervención. El checkpoint se conserva, pero no debe convertir el
        // fallo en un bucle de reintentos cada minuto.
        logger.error(
          "[Market Assets Scheduler] Error fatal de SteamWebAPI; se conserva el checkpoint hasta el próximo ciclo normal.",
        );
      } else if (
        error instanceof MarketAssetsApiError &&
        error.status === 429
      ) {
        // El 429 es el único error de la API que se recupera automáticamente
        // al abrirse la siguiente ventana. Los demás errores transitorios ya
        // agotaron los intentos acotados del cliente HTTP.
        await scheduleResumableFailure().catch((statusError) => {
          logger.error(
            "[Market Assets Scheduler] No se pudo calcular la reanudación por cuota:",
            statusError,
          );
        });
      } else if (error instanceof MarketAssetsApiError) {
        logger.error(
          "[Market Assets Scheduler] Error transitorio de SteamWebAPI con reintentos agotados; se conserva el checkpoint hasta el próximo ciclo normal.",
        );
      } else {
        await scheduleResumableFailure().catch((statusError) => {
          logger.error(
            "[Market Assets Scheduler] No se pudo calcular la reanudación:",
            statusError,
          );
        });
      }
    } finally {
      if (stopped) return;

      // Un error fatal no debe provocar una tormenta. Un éxito recalcula desde
      // el timestamp durable que también puede haber actualizado una corrida manual.
      if (succeeded) {
        await scheduleFromDurableState().catch((error) => {
          logger.error(
            "[Market Assets Scheduler] Error leyendo próximo ciclo:",
            error,
          );
          schedule(intervalMs);
        });
      } else if (!timer) {
        schedule(intervalMs);
      }
    }
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      if (!dependencies.enabled) {
        logger.log(
          "[Market Assets Scheduler] Desactivado: ENABLE_SYNC debe estar habilitado.",
        );
        return;
      }

      void scheduleFromDurableState().catch((error) => {
        logger.error(
          "[Market Assets Scheduler] No se pudo leer el estado inicial; se reintentará inmediatamente:",
          error,
        );
        schedule(MIN_DELAY_MS);
      });
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function startMarketAssetsSyncScheduler(): void {
  createFullCatalogSyncScheduler({
    enabled: config.enableSync,
    intervalMinutes: config.marketAssetsSync.intervalMinutes,
    getStatus: () => getMarketSyncStatusUseCase.execute(),
    execute: () => runFullCatalogSyncUseCase.execute("scheduler"),
  }).start();
}

/** @deprecated Usar `startMarketAssetsSyncScheduler`. */
export function startFullCatalogSyncScheduler(): void {
  startMarketAssetsSyncScheduler();
}
