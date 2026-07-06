export interface MarketSyncStatus {
  running: boolean;
  phase: 'idle' | 'fetching_youpin' | 'saving_database' | 'syncing_bots' | 'completed' | 'failed';
  currentPage: number;
  maxPages: number;
  listingsProcessed: number;
  totalListings: number;
  floatsIndexed: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  message: string | null;
}

class MarketSyncProgressService {
  private status: MarketSyncStatus = {
    running: false,
    phase: 'idle',
    currentPage: 0,
    maxPages: 0,
    listingsProcessed: 0,
    totalListings: 0,
    floatsIndexed: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
    message: null,
  };

  getStatus(): MarketSyncStatus {
    return { ...this.status };
  }

  startSync(maxPages: number) {
    this.status.running = true;
    this.status.phase = 'fetching_youpin';
    this.status.currentPage = 0;
    this.status.maxPages = maxPages;
    this.status.listingsProcessed = 0;
    this.status.totalListings = 0;
    this.status.floatsIndexed = 0;
    this.status.lastStartedAt = new Date().toISOString();
    this.status.lastFinishedAt = null;
    this.status.lastError = null;
    this.status.message = 'Iniciando descarga de catálogo de YouPin...';
  }

  updateFetchPage(page: number, assetsCount: number) {
    this.status.currentPage = page;
    this.status.message = `Descargando página ${page}/${this.status.maxPages} de YouPin (${assetsCount} assets acumulados)...`;
  }

  startDatabaseSave(totalListings: number) {
    this.status.phase = 'saving_database';
    this.status.totalListings = totalListings;
    this.status.listingsProcessed = 0;
    this.status.message = `Procesando y guardando ${totalListings} listings en la base de datos...`;
  }

  updateDatabaseProgress(processed: number) {
    this.status.listingsProcessed = processed;
    this.status.message = `Guardando listings en base de datos: ${processed}/${this.status.totalListings}`;
  }

  startSyncingBots() {
    this.status.phase = 'syncing_bots';
    this.status.message = 'Sincronizando inventario y precios de bots de Steam...';
  }

  completeSync(listingsCount: number, floatsCount: number) {
    this.status.running = false;
    this.status.phase = 'completed';
    this.status.listingsProcessed = listingsCount;
    this.status.totalListings = listingsCount;
    this.status.floatsIndexed = floatsCount;
    this.status.lastFinishedAt = new Date().toISOString();
    this.status.message = `Sincronización completa finalizada con éxito. ${listingsCount} listings y ${floatsCount} floats indexados.`;
  }

  failSync(error: string) {
    this.status.running = false;
    this.status.phase = 'failed';
    this.status.lastError = error;
    this.status.lastFinishedAt = new Date().toISOString();
    this.status.message = `Error en sincronización: ${error}`;
  }
}

export const marketSyncProgressService = new MarketSyncProgressService();
