import { IRaffleRepository } from "../domain/Raffle";
import { DrawRaffleUseCase } from "./RaffleUseCases";

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
        console.log(`[ProcessPendingDraws] Ejecutando sorteo para la rifa ${raffle.id} (${raffle.name})...`);
        await this.drawRaffleUseCase.execute(raffle.id);
        console.log(`[ProcessPendingDraws] Sorteo ${raffle.id} ejecutado correctamente.`);
      } catch (error) {
        console.error(`[ProcessPendingDraws Error] Fallo al ejecutar el sorteo ${raffle.id}:`, error);
      }
    }
  }
}
