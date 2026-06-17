import { PrismaMarketRepository } from './PrismaMarketRepository';
import { SyncResaleItemFloatsUseCase } from '../application/SyncResaleItemFloatsUseCase';
import { ReindexMarketFloatsUseCase } from '../application/ReindexMarketFloatsUseCase';
import { config } from '../../../shared/config';

/**
 * Scheduler de reindexado de floats.
 *
 * Recorre los listings elegibles (con desgaste) en pasadas diarias que respetan el
 * presupuesto del plan Float Small. Como el catálogo elegible es grande (~13k ítems)
 * y el límite diario es 5.000 requests, una pasada completa puede tomar varios días;
 * el scheduler avanza un poco cada ciclo priorizando lo menos actualizado.
 */
export function startMarketFloatsSyncScheduler(): void {
  // Por defecto NO se reindexa en background: consumiría el cupo del plan.
  // Los floats se obtienen bajo demanda al abrir el modal de cada ítem.
  if (!config.floatSync.enableReindex) {
    console.log(
      '[Market Floats Sync Scheduler] Reindexado masivo DESACTIVADO. Los floats se piden bajo demanda. ' +
        'Para precalentar el catálogo manualmente: npm run reindex-floats. ' +
        'Para activarlo en background: FLOAT_SYNC_ENABLE_REINDEX=true.',
    );
    return;
  }

  if (!config.enableSync) {
    console.log('[Market Floats Sync Scheduler] Reindexado automático de floats desactivado (ENABLE_SYNC=false).');
    return;
  }

  const marketRepository = new PrismaMarketRepository();
  const syncUseCase = new SyncResaleItemFloatsUseCase(marketRepository);
  const reindexUseCase = new ReindexMarketFloatsUseCase(marketRepository, syncUseCase);

  let running = false;

  const runReindexJob = async () => {
    if (running) {
      console.log('[Market Floats Sync Scheduler] Job anterior aún en curso; se omite este ciclo.');
      return;
    }
    running = true;
    try {
      await reindexUseCase.execute();
    } catch (err: any) {
      console.error('[Market Floats Sync Scheduler] Job crashed:', err.message || err);
    } finally {
      running = false;
    }
  };

  // Primera pasada 2 minutos después del arranque (no competir con el boot).
  setTimeout(runReindexJob, 2 * 60 * 1000);

  // Pasada periódica cada 6 horas (4 ciclos/día). Cada ciclo respeta su propio presupuesto.
  const intervalMs = 6 * 60 * 60 * 1000;
  setInterval(runReindexJob, intervalMs);
}
