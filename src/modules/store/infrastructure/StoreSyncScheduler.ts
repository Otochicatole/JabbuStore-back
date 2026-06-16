import { PrismaStoreRepository } from './PrismaStoreRepository';
import { SyncStoreItemsUseCase } from '../application/SyncStoreItemsUseCase';
import { config } from '../../../shared/config';

export function startStoreSyncScheduler() {
  if (!config.enableSync) {
    console.log('[Store Sync Scheduler] Sincronización automática desactivada en la configuración (ENABLE_SYNC=false).');
    return;
  }
  const intervalMinutes = config.storeSyncIntervalMinutes;
  const storeRepository = new PrismaStoreRepository();
  const syncStoreItemsUseCase = new SyncStoreItemsUseCase(storeRepository);

  // Ejecución inicial asíncrona al arrancar el servidor
  console.log('[Store Sync Scheduler] Initializing first store synchronization...');
  syncStoreItemsUseCase.execute()
    .then(() => {
      console.log('[Store Sync Scheduler] Initial store sync successful!');
    })
    .catch((error) => {
      console.error('[Store Sync Scheduler Error] Initial store sync failed:', error);
    });

  // Temporizador de refresco en segundo plano
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(async () => {
    console.log('[Store Sync Scheduler] Running scheduled synchronization...');
    try {
      await syncStoreItemsUseCase.execute();
    } catch (error) {
      console.error('[Store Sync Scheduler Error] Scheduled store sync failed:', error);
    }
  }, intervalMs);
}
