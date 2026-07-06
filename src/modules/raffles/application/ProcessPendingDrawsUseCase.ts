import { IRaffleRepository } from "../domain/Raffle";
import { DrawRaffleUseCase } from "./RaffleUseCases";
import { emitLiveRaffleStart } from "../../tickets/infrastructure/TicketSocket";

export class ProcessPendingDrawsUseCase {
  constructor(
    private raffleRepository: IRaffleRepository,
    private drawRaffleUseCase: DrawRaffleUseCase
  ) {}

  async execute(): Promise<void> {
    const readyRaffles = await this.raffleRepository.findRafflesReadyToDraw();
    
    if (readyRaffles.length === 0) {
      return;
    }

    console.log(`[ProcessPendingDraws] Encontradas ${readyRaffles.length} rifas listas para sortear.`);

    for (const raffle of readyRaffles) {
      try {
        console.log(`[ProcessPendingDraws] Preparando sorteo en vivo para la rifa ${raffle.id} (${raffle.name})...`);
        // Notify clients that the live draw is starting
        try {
          emitLiveRaffleStart(raffle.id);
        } catch (e) {
          console.error(`[ProcessPendingDraws Error] Fallo al emitir live start para ${raffle.id}:`, e);
        }

        // Wait 3 seconds to let clients show a "Starting..." animation if they want
        await new Promise((resolve) => setTimeout(resolve, 3000));

        console.log(`[ProcessPendingDraws] Ejecutando algoritmo de sorteo para ${raffle.id}...`);
        await this.drawRaffleUseCase.execute(raffle.id);
        console.log(`[ProcessPendingDraws] Sorteo ${raffle.id} ejecutado correctamente.`);
      } catch (error) {
        console.error(`[ProcessPendingDraws Error] Fallo al ejecutar el sorteo ${raffle.id}:`, error);
      }
    }
  }
}
