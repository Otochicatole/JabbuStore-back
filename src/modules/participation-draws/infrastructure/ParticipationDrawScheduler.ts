import { PrismaParticipationDrawRepository } from "./PrismaParticipationDrawRepository";
import { DrawParticipationDrawUseCase } from "../application/ParticipationDrawUseCases";
import { ProcessPendingParticipationDrawsUseCase } from "../application/ProcessPendingParticipationDrawsUseCase";

export function startParticipationDrawScheduler() {
  const repository = new PrismaParticipationDrawRepository();
  const drawUseCase = new DrawParticipationDrawUseCase(repository);
  const processPending = new ProcessPendingParticipationDrawsUseCase(
    repository,
    drawUseCase,
  );

  const intervalMs = 10 * 1000;

  console.log(
    "[ParticipationDraw Scheduler] Iniciando scheduler de sorteos por participación. Intervalo: 10s",
  );

  processPending.execute().catch((e) => {
    console.error(
      "[ParticipationDraw Scheduler Error] Error en revisión inicial:",
      e,
    );
  });

  setInterval(async () => {
    try {
      await processPending.execute();
    } catch (error) {
      console.error(
        "[ParticipationDraw Scheduler Error] Fallo al procesar sorteos pendientes:",
        error,
      );
    }
  }, intervalMs);
}
