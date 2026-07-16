import { PrismaMarketRepository } from './PrismaMarketRepository';
import { PrismaMarketSyncStateRepository } from './PrismaMarketSyncStateRepository';
import { SyncMarketListingsUseCase } from '../application/SyncMarketListingsUseCase';
import { config } from '../../../shared/config';

/**
 * Scheduler independiente para el catálogo de market listings (YouPin).
 * Corre en su propio intervalo, separado del sync de inventario de bots.
 */
export function startMarketSyncScheduler(): void {
  if (!config.enableSync) {
    console.log('[Market Sync Scheduler] Sincronización automática desactivada en la configuración (ENABLE_SYNC=false).');
    return;
  }
  const intervalMinutes = config.storeSyncIntervalMinutes; // reusar configuración existente
  const marketRepository = new PrismaMarketRepository();
  const marketSyncStateRepository = new PrismaMarketSyncStateRepository();
  const syncUseCase = new SyncMarketListingsUseCase(
    marketRepository,
    marketSyncStateRepository,
  );

  // Sincronización inicial al arrancar el servidor
  console.log('[Market Sync Scheduler] Iniciando primera sincronización del catálogo de mercado...');
  syncUseCase.execute()
    .then(({ synced, skipped }) => {
      console.log(`[Market Sync Scheduler] Sincronización inicial completa: ${synced} listings, ${skipped} omitidos.`);
    })
    .catch((error) => {
      console.error('[Market Sync Scheduler] Error en sincronización inicial:', error);
    });

  // Refresco periódico en segundo plano
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(async () => {
    console.log('[Market Sync Scheduler] Ejecutando sincronización programada...');
    try {
      const { synced, skipped } = await syncUseCase.execute();
      console.log(`[Market Sync Scheduler] Sync completado: ${synced} listings, ${skipped} omitidos.`);
    } catch (error) {
      console.error('[Market Sync Scheduler] Error en sincronización programada:', error);
    }
  }, intervalMs);
}
