import { config } from "../../../shared/config";
import { itemsCatalogRefreshService } from "../application/ItemsCatalogRefreshService";

const MIN_DELAY_MS = 1_000;
const RUNNING_RETRY_MS = 60_000;

export interface LocalPriceCatalogSchedulerStatus {
  exists: boolean;
  fetchedAt: string | null;
  running?: boolean;
}

export interface LocalPriceCatalogSchedulerResult {
  itemCount: number;
  fetchedAt: string | null;
}

export interface LocalPriceCatalogSchedulerDependencies {
  enabled: boolean;
  intervalMinutes: number;
  getStatus(): Promise<LocalPriceCatalogSchedulerStatus>;
  execute(): Promise<LocalPriceCatalogSchedulerResult>;
  logger?: Pick<Console, "log" | "error">;
}

export interface LocalPriceCatalogSchedulerHandle {
  start(): void;
  stop(): void;
}

/**
 * Scheduler recursivo del JSON local de precios. Es deliberadamente ajeno a
 * la recolección de assets y al inventario de bots: sólo reemplaza
 * `items-catalog.json` cuando la descarga completa fue validada.
 */
export function createLocalPriceCatalogSyncScheduler(
  dependencies: LocalPriceCatalogSchedulerDependencies,
): LocalPriceCatalogSchedulerHandle {
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

  const delayFromStatus = (
    status: LocalPriceCatalogSchedulerStatus,
  ): number => {
    if (status.running) return RUNNING_RETRY_MS;
    if (!status.exists || !status.fetchedAt) return MIN_DELAY_MS;

    const fetchedAtMs = new Date(status.fetchedAt).getTime();
    if (!Number.isFinite(fetchedAtMs) || fetchedAtMs <= 0) {
      return MIN_DELAY_MS;
    }
    return Math.max(MIN_DELAY_MS, fetchedAtMs + intervalMs - Date.now());
  };

  const scheduleFromCurrentStatus = async () => {
    const status = await dependencies.getStatus();
    const delay = delayFromStatus(status);
    logger.log(
      status.running
        ? "[Local Price Catalog Scheduler] Ya existe un refresh en curso; se volverá a comprobar en 60 segundos."
        : `[Local Price Catalog Scheduler] Próxima ejecución en ${Math.ceil(delay / 60_000)} minuto(s).`,
    );
    schedule(delay);
  };

  async function runAndReschedule() {
    timer = null;
    if (stopped) return;

    try {
      // Una ejecución manual puede haber refrescado el archivo desde que se
      // armó el timer. Releer evita una descarga automática redundante.
      const status = await dependencies.getStatus();
      const delay = delayFromStatus(status);
      if (delay > MIN_DELAY_MS) {
        schedule(delay);
        return;
      }

      const result = await dependencies.execute();
      logger.log(
        `[Local Price Catalog Scheduler] Catálogo actualizado: ${result.itemCount} items (fetchedAt=${result.fetchedAt ?? "desconocido"}).`,
      );
      await scheduleFromCurrentStatus();
    } catch (error) {
      logger.error("[Local Price Catalog Scheduler] Error:", error);
      // Un error de Items API no debe convertirse en una tormenta. El store
      // atómico conserva el archivo anterior y el próximo intento usa el ciclo
      // normal configurado.
      schedule(intervalMs);
    }
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      if (!dependencies.enabled) {
        logger.log(
          "[Local Price Catalog Scheduler] Desactivado: ENABLE_ITEMS_CATALOG_SYNC debe estar habilitado.",
        );
        return;
      }

      void scheduleFromCurrentStatus().catch((error) => {
        logger.error(
          "[Local Price Catalog Scheduler] No se pudo leer el estado inicial; se reintentará inmediatamente:",
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

export function startLocalPriceCatalogSyncScheduler(): void {
  createLocalPriceCatalogSyncScheduler({
    enabled: config.enableItemsCatalogSync,
    intervalMinutes: config.itemsCatalog.syncIntervalMinutes,
    getStatus: () => itemsCatalogRefreshService.getStatus(),
    execute: () =>
      itemsCatalogRefreshService.refreshNow({ triggeredBy: "scheduler" }),
  }).start();
}
