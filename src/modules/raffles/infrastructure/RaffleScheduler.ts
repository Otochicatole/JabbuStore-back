import { PrismaRaffleRepository } from './PrismaRaffleRepository';
import { ProcessPendingDrawsUseCase } from '../application/ProcessPendingDrawsUseCase';
import { DrawRaffleUseCase } from '../application/RaffleUseCases';

export function startRaffleScheduler() {
  const raffleRepository = new PrismaRaffleRepository();
  const drawRaffleUseCase = new DrawRaffleUseCase(raffleRepository);
  const processPendingDrawsUseCase = new ProcessPendingDrawsUseCase(raffleRepository, drawRaffleUseCase);

  const intervalMs = 10 * 1000; // 10 segundos
  
  console.log(`[Raffle Scheduler] Iniciando scheduler de sorteos automáticos. Intervalo de revisión: 10s`);

  // Primera verificación al levantar
  processPendingDrawsUseCase.execute().catch(e => {
    console.error('[Raffle Scheduler Error] Error en revisión inicial de sorteos pendientes:', e);
  });

  setInterval(async () => {
    try {
      await processPendingDrawsUseCase.execute();
    } catch (error) {
      console.error('[Raffle Scheduler Error] Fallo al procesar los sorteos pendientes:', error);
    }
  }, intervalMs);
}
