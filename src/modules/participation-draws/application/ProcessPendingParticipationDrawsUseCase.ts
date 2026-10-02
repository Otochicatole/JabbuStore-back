import type { IParticipationDrawRepository } from "../domain/ParticipationDraw";
import { DrawParticipationDrawUseCase } from "./ParticipationDrawUseCases";

export class ProcessPendingParticipationDrawsUseCase {
  constructor(
    private repository: IParticipationDrawRepository,
    private drawUseCase: DrawParticipationDrawUseCase,
  ) {}

  async execute(): Promise<void> {
    const readyDraws = await this.repository.findDrawsReadyToDraw();

    if (readyDraws.length === 0) {
      return;
    }

    console.log(
      `[ProcessPendingParticipationDraws] Encontrados ${readyDraws.length} sorteos listos para ejecutar.`,
    );

    for (const draw of readyDraws) {
      try {
        console.log(
          `[ProcessPendingParticipationDraws] Ejecutando sorteo ${draw.id} (${draw.name})...`,
        );
        await this.drawUseCase.execute(draw.id);
        console.log(
          `[ProcessPendingParticipationDraws] Sorteo ${draw.id} ejecutado correctamente.`,
        );
      } catch (error) {
        console.error(
          `[ProcessPendingParticipationDraws Error] Fallo al ejecutar el sorteo ${draw.id}:`,
          error,
        );
      }
    }
  }
}
