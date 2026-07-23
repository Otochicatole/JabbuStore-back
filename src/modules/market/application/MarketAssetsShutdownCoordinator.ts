type MarketAssetsShutdownHandler = () => Promise<void>;

/**
 * Puente mínimo entre el bootstrap HTTP y la recolección activa.
 *
 * El proceso sigue teniendo una sola corrida por vez, por lo que sólo existe
 * un handler activo. El bootstrap puede dejar de aceptar tráfico, solicitar
 * que el dispatcher cancele/drene sus workers y esperar el checkpoint final
 * antes de cerrar Prisma y terminar el proceso.
 */
export class MarketAssetsShutdownCoordinator {
  private activeHandler: MarketAssetsShutdownHandler | null = null;

  register(handler: MarketAssetsShutdownHandler): () => void {
    if (this.activeHandler) {
      throw new Error(
        "Ya existe una recolección de assets registrada para apagado.",
      );
    }
    this.activeHandler = handler;
    return () => {
      if (this.activeHandler === handler) this.activeHandler = null;
    };
  }

  async prepareForShutdown(): Promise<void> {
    await this.activeHandler?.();
  }

  hasActiveCollection(): boolean {
    return this.activeHandler !== null;
  }
}

export const marketAssetsShutdownCoordinator =
  new MarketAssetsShutdownCoordinator();
