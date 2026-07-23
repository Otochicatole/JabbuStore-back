export type MarketAssetsStopReason = "shutdown" | "user_cancelled";

type MarketAssetsShutdownHandler = (
  reason: MarketAssetsStopReason,
) => Promise<void>;

export interface MarketAssetsStopRequest {
  accepted: boolean;
  alreadyRequested: boolean;
  completion: Promise<void> | null;
}

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
  private activeStop: Promise<void> | null = null;

  register(handler: MarketAssetsShutdownHandler): () => void {
    if (this.activeHandler) {
      throw new Error(
        "Ya existe una recolección de assets registrada para apagado.",
      );
    }
    this.activeHandler = handler;
    this.activeStop = null;
    return () => {
      if (this.activeHandler === handler) {
        this.activeHandler = null;
        this.activeStop = null;
      }
    };
  }

  async prepareForShutdown(): Promise<void> {
    const request = this.requestStop("shutdown");
    await request.completion;
  }

  requestCancellation(): MarketAssetsStopRequest {
    return this.requestStop("user_cancelled");
  }

  hasActiveCollection(): boolean {
    return this.activeHandler !== null;
  }

  private requestStop(reason: MarketAssetsStopReason): MarketAssetsStopRequest {
    if (!this.activeHandler) {
      return {
        accepted: false,
        alreadyRequested: false,
        completion: null,
      };
    }
    if (this.activeStop) {
      return {
        accepted: true,
        alreadyRequested: true,
        completion: this.activeStop,
      };
    }

    // El handler cambia su estado antes del primer await, por lo que desde este
    // punto no se despachan requests nuevos aunque la API responda 202 enseguida.
    this.activeStop = this.activeHandler(reason);
    return {
      accepted: true,
      alreadyRequested: false,
      completion: this.activeStop,
    };
  }
}

export const marketAssetsShutdownCoordinator =
  new MarketAssetsShutdownCoordinator();
