import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { PrismaMarketRepository } from './PrismaMarketRepository';
import { SyncResaleItemFloatsUseCase } from '../application/SyncResaleItemFloatsUseCase';
import { config } from '../../../shared/config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function startMarketFloatsSyncScheduler(): void {
  if (!config.enableSync) {
    console.log('[Market Floats Sync Scheduler] Sincronización automática de floats desactivada (ENABLE_SYNC=false).');
    return;
  }

  const marketRepository = new PrismaMarketRepository();
  const syncUseCase = new SyncResaleItemFloatsUseCase(marketRepository);

  const runSyncJob = async () => {
    console.log('[Market Floats Sync Scheduler] Starting scheduled resale floats synchronization...');
    try {
      const listings = await prisma.marketListing.findMany({
        select: { id: true, name: true }
      });
      
      console.log(`[Market Floats Sync Scheduler] Found ${listings.length} listings to update.`);

      for (const listing of listings) {
        try {
          await syncUseCase.execute(listing.id, listing.name);
        } catch (itemErr: any) {
          console.error(`[Market Floats Sync Scheduler Error] Failed for listing "${listing.name}":`, itemErr.message || itemErr);
        }
        
        // Espera de cortesía de 1.5s entre llamadas para evitar bloqueos por límite de peticiones de la API
        await sleep(1500);
      }
      
      console.log('[Market Floats Sync Scheduler] Resale floats sync job completed.');
    } catch (err: any) {
      console.error('[Market Floats Sync Scheduler Error] Sync job crashed:', err.message || err);
    }
  };

  // Ejecución inicial 5 minutos después del arranque para no competir con el inicio del servidor
  setTimeout(() => {
    runSyncJob();
  }, 5 * 60 * 1000);

  // Ejecución periódica cada 4 horas
  const intervalMs = 4 * 60 * 60 * 1000;
  setInterval(() => {
    runSyncJob();
  }, intervalMs);
}
