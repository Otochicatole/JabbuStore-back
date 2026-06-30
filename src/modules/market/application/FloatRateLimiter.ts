import { config } from "../../../shared/config";

/**
 * Rate limiter por FILAS para el endpoint /steam/api/float/assets de SteamWebAPI.
 *
 * Dato confirmado por los headers x-ratelimit-* del plan "Float Small":
 * el límite se mide en FILAS, no en requests: cada request consume `limit`
 * unidades del cupo (100 filas por ventana de 60s).
 *
 * Estrategia:
 *  - Token bucket con refill continuo (permite ráfagas chicas para el modal on-demand).
 *  - Se auto-corrige con el header `x-ratelimit-remaining` que envía el servidor
 *    (fuente de verdad real del cupo restante en la ventana actual).
 *  - Ante un 429 entra en cooldown duro hasta que la ventana se renueva.
 */
class FloatRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private cooldownUntil = 0;
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor() {
    this.capacity = config.floatSync.maxRowsPerMinute;
    this.refillPerMs = this.capacity / 60_000;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = now;
    }
  }

  /** Espera hasta poder consumir `rows` del cupo (respetando cooldown y tokens). */
  async acquire(rows: number): Promise<void> {
    const cost = Math.min(rows, this.capacity);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const now = Date.now();
      if (now < this.cooldownUntil) {
        await this.sleep(Math.min(this.cooldownUntil - now, 5_000));
        continue;
      }
      this.refill();
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      const deficit = cost - this.tokens;
      const waitMs = Math.ceil(deficit / this.refillPerMs);
      await this.sleep(Math.min(waitMs, 5_000));
    }
  }

  /** Ajusta los tokens al valor real informado por el servidor (x-ratelimit-remaining). */
  observeRemaining(remainingHeader: string | null): void {
    if (!remainingHeader) return;
    const remaining = Number(remainingHeader);
    if (Number.isFinite(remaining)) {
      this.tokens = Math.max(0, Math.min(this.tokens, remaining));
      this.lastRefill = Date.now();
    }
  }

  /** Marca un 429: vacía el cupo y espera la renovación de la ventana (~60s). */
  penalize(): void {
    this.tokens = 0;
    this.cooldownUntil = Date.now() + 60_000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const floatRateLimiter = new FloatRateLimiter();
