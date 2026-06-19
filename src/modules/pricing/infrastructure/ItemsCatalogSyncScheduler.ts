import { config } from "../../../shared/config";
import { itemsCatalogRefreshService } from "../application/ItemsCatalogRefreshService";

export function startItemsCatalogSyncScheduler(): void {
  if (!config.enableSync) {
    console.log(
      "[Items Catalog Scheduler] Sincronización automática desactivada (ENABLE_SYNC=false).",
    );
    return;
  }

  if (!config.enableItemsCatalogSync) {
    console.log(
      "[Items Catalog Scheduler] Refresh automático del catálogo desactivado (ENABLE_ITEMS_CATALOG_SYNC=false).",
    );
    return;
  }

  const intervalMinutes = config.itemsCatalog.syncIntervalMinutes;
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(
    `[Items Catalog Scheduler] Inicializado. Intervalo: ${intervalMinutes} minuto(s).`,
  );

  itemsCatalogRefreshService
    .getStatus()
    .then((status) => {
      if (!status.exists || status.stale) {
        console.log(
          "[Items Catalog Scheduler] Catálogo inexistente o stale. Iniciando refresh en background...",
        );
        void itemsCatalogRefreshService.startRefreshInBackground({
          triggeredBy: "scheduler-startup",
        });
      } else {
        console.log(
          `[Items Catalog Scheduler] Catálogo vigente (${status.itemCount} items, fetchedAt=${status.fetchedAt}).`,
        );
      }
    })
    .catch((error) => {
      console.error("[Items Catalog Scheduler] Error leyendo status inicial:", error);
    });

  setInterval(async () => {
    console.log("[Items Catalog Scheduler] Ejecutando refresh programado...");
    const result = await itemsCatalogRefreshService.startRefreshInBackground({
      triggeredBy: "scheduler",
    });
    if (!result.started) {
      console.log(
        "[Items Catalog Scheduler] Refresh omitido: ya hay una descarga en curso.",
      );
    }
  }, intervalMs);
}
