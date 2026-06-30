import 'dotenv/config';
import { PrismaMarketRepository } from '../src/modules/market/infrastructure/PrismaMarketRepository';
import { SyncResaleItemFloatsUseCase } from '../src/modules/market/application/SyncResaleItemFloatsUseCase';
import { ReindexMarketFloatsUseCase } from '../src/modules/market/application/ReindexMarketFloatsUseCase';

/**
 * Reindexa floats del catálogo respetando el cupo de FILAS del plan Float Small.
 *
 * El plan limita FILAS (no requests): 100 filas/min, 5.000/día, 50.000/mes.
 * El rate limiter interno (token bucket por filas) se encarga del pacing; este
 * script solo fija el presupuesto total de filas de la corrida.
 *
 * Uso:
 *   npx ts-node --transpile-only scripts/reindex-floats.ts [rowBudget] [csfloat]
 *
 * Ejemplos:
 *   npx ts-node --transpile-only scripts/reindex-floats.ts             # presupuesto por defecto (config)
 *   npx ts-node --transpile-only scripts/reindex-floats.ts 4500        # 4500 filas (~1 día de cupo)
 *   npx ts-node --transpile-only scripts/reindex-floats.ts 1000 csfloat # incluye CSFloat
 *
 * Corré varias veces (días distintos): prioriza lo nunca intentado / más viejo / mayor precio.
 */
async function main() {
  const [budgetArg, csfloatArg] = process.argv.slice(2);

  const rowBudget = budgetArg ? parseInt(budgetArg, 10) : undefined;
  const includeCsfloat = csfloatArg === 'csfloat' || csfloatArg === 'true';

  const repo = new PrismaMarketRepository();
  const syncUseCase = new SyncResaleItemFloatsUseCase(repo);
  const reindex = new ReindexMarketFloatsUseCase(repo, syncUseCase);

  const result = await reindex.execute({ rowBudget, includeCsfloat });
  console.log('[Reindex Floats Script] Resultado final:', result);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Reindex Floats Script] Error:', err);
  process.exit(1);
});
