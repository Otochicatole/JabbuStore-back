import type { IMarketRepository } from '../domain/IMarketRepository';
import type { IMarketSyncStateRepository } from '../domain/IMarketSyncStateRepository';
import { itemsCatalogRefreshService } from '../../pricing/application/ItemsCatalogRefreshService';
import { DownloadYoupinPricesUseCase } from './DownloadYoupinPricesUseCase';
import { GenerateCatalogGlobalUseCase } from './GenerateCatalogGlobalUseCase';
import { SyncCatalogGlobalToDbUseCase } from './SyncCatalogGlobalToDbUseCase';

export const YOUPIN_CATALOG_SYNC_STATE_KEY = 'youpin-catalog-v2';

export interface SyncYoupinCatalogResult {
  matched: number;
  skippedNoPrice: number;
  skippedNotInCatalog: number;
  totalCatalogItems: number;
  totalPriceRows: number;
  durationMs: number;
}

/**
 * Proceso Sincronizacion Completa del catalogo YouPin.
 *
 * Ejecuta en secuencia:
 *   Paso 1: Descargar /steam/api/items → steamwebapi-json-data/items-catalog.json
 *   Paso 2: Descargar /market/youpin/prices → steamwebapi-json-data/youpin-prices.json
 *   Paso 3: Generar steamwebapi-json-data/catalog-global.json (filtrando items por youpin-prices)
 *   Paso 4: Sincronizar catalog-global.json a la Base de Datos (MarketListing)
 */
export class SyncYoupinCatalogUseCase {
  constructor(
    private readonly marketRepository: IMarketRepository,
    private readonly syncStateRepository: IMarketSyncStateRepository,
    private readonly downloadPricesUseCase = new DownloadYoupinPricesUseCase(),
    private readonly generateCatalogGlobalUseCase = new GenerateCatalogGlobalUseCase(),
    private readonly syncDbUseCase = new SyncCatalogGlobalToDbUseCase(marketRepository),
  ) {}

  async execute(): Promise<SyncYoupinCatalogResult> {
    const start = Date.now();
    console.log('[SyncYoupinCatalog] Iniciando sincronización completa del catálogo YouPin (Pasos 1 a 4)...');

    await this.syncStateRepository.markStarted(
      YOUPIN_CATALOG_SYNC_STATE_KEY,
      undefined,
      0,
      { phase: 'downloading_items' },
    ).catch(() => undefined);

    // 1. Paso 1: Refrescar/Descargar items-catalog.json
    console.log('[SyncYoupinCatalog] Paso 1: Descargando/verificando items-catalog.json...');
    await itemsCatalogRefreshService.refreshNow({ triggeredBy: 'sync' });

    // 2. Paso 2: Descargar /market/youpin/prices → youpin-prices.json
    await this.syncStateRepository.updateCurrentStatus?.(YOUPIN_CATALOG_SYNC_STATE_KEY, {
      phase: 'downloading_youpin_prices',
    }).catch(() => undefined);

    console.log('[SyncYoupinCatalog] Paso 2: Descargando /market/youpin/prices -> youpin-prices.json...');
    const pricesResult = await this.downloadPricesUseCase.execute();

    // 3. Paso 3: Generar catalog-global.json
    await this.syncStateRepository.updateCurrentStatus?.(YOUPIN_CATALOG_SYNC_STATE_KEY, {
      phase: 'normalizing',
    }).catch(() => undefined);

    console.log('[SyncYoupinCatalog] Paso 3: Generando catalog-global.json...');
    const globalResult = await this.generateCatalogGlobalUseCase.execute();

    // 4. Paso 4: Sincronizar catalog-global.json a BD (MarketListing)
    await this.syncStateRepository.updateCurrentStatus?.(YOUPIN_CATALOG_SYNC_STATE_KEY, {
      phase: 'publishing_listings',
    }).catch(() => undefined);

    console.log('[SyncYoupinCatalog] Paso 4: Sincronizando catalog-global.json a BD...');
    const dbResult = await this.syncDbUseCase.execute();

    const durationMs = Date.now() - start;

    return {
      matched: dbResult.totalListingsUpserted,
      skippedNoPrice: globalResult.totalPriceRows - globalResult.matchedItemsCount,
      skippedNotInCatalog: Math.max(0, globalResult.totalPriceRows - globalResult.matchedItemsCount),
      totalCatalogItems: globalResult.totalCatalogItems,
      totalPriceRows: globalResult.totalPriceRows,
      durationMs,
    };
  }
}