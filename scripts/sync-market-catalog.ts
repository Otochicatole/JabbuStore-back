import 'dotenv/config';
import { applyRuntimeConfigOverrides } from '../src/shared/config';
import { runFullCatalogSyncUseCase } from '../src/modules/market/infrastructure/MarketSyncDependencies';

async function main() {
  await applyRuntimeConfigOverrides();
  const result = await runFullCatalogSyncUseCase.execute('script');
  console.log('[Sync Market Catalog] Resultado:', result);
}

main().catch((err) => {
  console.error('[Sync Market Catalog] Error:', err);
  process.exit(1);
});
