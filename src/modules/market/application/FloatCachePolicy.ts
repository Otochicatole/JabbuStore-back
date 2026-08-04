/**
 * Politica de cache para los floats de un MarketListing.
 *
 * Encapsula la decision de si una sincronizacion de /steam/api/float/assets
 * debe ejecutarse o si los datos en BD son suficientemente recientes.
 *
 * Estados logicos derivables:
 *   NOT_REQUESTED    -> floatsSyncedAt = null
 *   FLOATS_AVAILABLE -> floatsSyncedAt != null + FloatItem disponibles
 *   NO_FLOATS_AVAILABLE -> floatsSyncedAt != null + sin FloatItem
 *   STALE            -> floatsSyncedAt fuera del TTL
 *   REFRESH_FAILED   -> fallo en actualizacion, se conservo ultimo estado
 */
export class FloatCachePolicy {
  readonly ttlMs: number;

  constructor(ttlMinutes?: number) {
    const raw = ttlMinutes ?? Number(process.env.YOUPIN_FLOAT_CACHE_TTL_MINUTES);
    const parsed = Number.isFinite(raw) && raw > 0 ? raw : 30;
    this.ttlMs = parsed * 60_000;
  }

  get ttlMinutes(): number {
    return this.ttlMs / 60_000;
  }

  shouldRefresh(floatsSyncedAt: Date | null): boolean {
    if (!floatsSyncedAt) return true;
    return Date.now() - floatsSyncedAt.getTime() > this.ttlMs;
  }

  isFresh(floatsSyncedAt: Date | null): boolean {
    return !this.shouldRefresh(floatsSyncedAt);
  }

  remainingMs(floatsSyncedAt: Date | null): number {
    if (!floatsSyncedAt) return 0;
    return Math.max(0, floatsSyncedAt.getTime() + this.ttlMs - Date.now());
  }
}

export const floatCachePolicy = new FloatCachePolicy();
