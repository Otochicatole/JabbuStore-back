import { IMarketRepository } from "../domain/IMarketRepository";
import { SyncResaleItemFloatsUseCase } from "./SyncResaleItemFloatsUseCase";
import { config } from "../../../shared/config";

export interface ReindexOptions {
  /** Tope de FILAS a consumir del cupo del plan en esta ejecución. */
  rowBudget?: number;
  /** Incluir CSFloat como respaldo (consume más cupo). */
  includeCsfloat?: boolean;
}

export interface ReindexResult {
  processed: number;
  withFloats: number;
  emptyResults: number;
  /** Ítems salteados por rate limit (NO se marcan como intentados; se reintentan luego). */
  skippedByRateLimit: number;
  rowsUsed: number;
  candidates: number;
  abortedByRateLimit: boolean;
}

/**
 * Reindexa floats de los listings elegibles (con desgaste) respetando el cupo de FILAS
 * del plan Float Small (100 filas/min, 5.000/día, 50.000/mes — confirmado por headers).
 *
 * El pacing real lo maneja `floatRateLimiter` (token bucket por filas) dentro del sync,
 * así que acá solo controlamos el presupuesto total de filas de la corrida y el orden
 * de prioridad (nunca intentados → más desactualizados → mayor precio).
 */
export class ReindexMarketFloatsUseCase {
  constructor(
    private marketRepository: IMarketRepository,
    private syncUseCase: SyncResaleItemFloatsUseCase,
  ) {}

  async execute(options: ReindexOptions = {}): Promise<ReindexResult> {
    const rowBudget = options.rowBudget ?? config.floatSync.reindexRowBudget;
    const includeCsfloat =
      options.includeCsfloat ?? config.floatSync.enableCsfloatInReindex;

    // Cada ítem consume al menos `maxPerItem` filas; pedimos candidatos de sobra.
    const maxCandidates = Math.ceil(rowBudget / config.floatSync.maxPerItem) + 50;
    const candidates = await this.marketRepository.findFloatEligibleForReindex(
      maxCandidates,
    );

    console.log(
      `[Reindex Floats] Inicio: ${candidates.length} candidatos, presupuesto ${rowBudget} filas, csfloat=${includeCsfloat}.`,
    );

    let processed = 0;
    let withFloats = 0;
    let emptyResults = 0;
    let skippedByRateLimit = 0;
    let rowsUsed = 0;
    let consecutiveRateLimits = 0;
    let abortedByRateLimit = false;

    for (const item of candidates) {
      if (rowsUsed >= rowBudget) {
        console.log(`[Reindex Floats] Presupuesto de filas agotado (${rowsUsed}/${rowBudget}).`);
        break;
      }

      try {
        const result = await this.syncUseCase.fetchFloats(item.id, item.name, {
          includeCsfloat,
        });
        rowsUsed += result.rowsUsed;
        processed++;

        if (result.floats.length > 0) {
          await this.marketRepository.saveFloats(item.id, result.floats);
          withFloats++;
        } else if (result.rateLimited) {
          // Sin floats por rate limit: NO marcar como intentado, se reintenta luego.
          skippedByRateLimit++;
        } else {
          // Genuinamente sin floats en la API: marcar como intentado.
          await this.marketRepository.saveFloats(item.id, []);
          emptyResults++;
        }

        if (result.rateLimited) {
          consecutiveRateLimits++;
          if (consecutiveRateLimits >= 6) {
            console.warn(
              "[Reindex Floats] 6 rate limits consecutivos; abortando para no saturar la API.",
            );
            abortedByRateLimit = true;
            break;
          }
        } else {
          consecutiveRateLimits = 0;
        }
      } catch (err: any) {
        console.error(`[Reindex Floats] Error en "${item.name}": ${err.message || err}`);
      }

      if (processed % 25 === 0) {
        console.log(
          `[Reindex Floats] Progreso: ${processed} procesados, ${withFloats} con floats, ${emptyResults} vacíos, ${skippedByRateLimit} salteados, ${rowsUsed} filas.`,
        );
      }
    }

    const result: ReindexResult = {
      processed,
      withFloats,
      emptyResults,
      skippedByRateLimit,
      rowsUsed,
      candidates: candidates.length,
      abortedByRateLimit,
    };

    console.log(`[Reindex Floats] Fin:`, JSON.stringify(result));
    return result;
  }
}
