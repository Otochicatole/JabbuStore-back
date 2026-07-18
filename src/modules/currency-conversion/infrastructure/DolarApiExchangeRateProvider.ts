import {
  type ExchangeRate,
  type IExchangeRateProvider,
  type UsdArsRateKind,
} from "../domain/CurrencyConversion";

const DOLAR_API_BASE_URL = "https://dolarapi.com";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

type CacheEntry = {
  expiresAt: number;
  rate: ExchangeRate;
};

type DolarApiPayload = {
  venta: number;
  casa: string | null;
  nombre: string | null;
  fechaActualizacion: string | null;
};

export class DolarApiExchangeRateProvider implements IExchangeRateProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ExchangeRate>>();

  getUsdArsRate(kind: UsdArsRateKind): Promise<ExchangeRate<UsdArsRateKind>> {
    return this.getRate(kind, `/v1/dolares/${kind}`) as Promise<ExchangeRate<UsdArsRateKind>>;
  }

  getBrlArsRate(): Promise<ExchangeRate<"brl">> {
    return this.getRate("brl", "/v1/cotizaciones/brl") as Promise<ExchangeRate<"brl">>;
  }

  private async getRate(kind: string, path: string): Promise<ExchangeRate> {
    const cached = this.cache.get(kind);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rate;
    }

    const pending = this.inFlight.get(kind);
    if (pending) return pending;

    const request = this.fetchRate(kind, path).finally(() => {
      this.inFlight.delete(kind);
    });
    this.inFlight.set(kind, request);
    return request;
  }

  private async fetchRate(kind: string, path: string): Promise<ExchangeRate> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${DOLAR_API_BASE_URL}${path}`, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const raw: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(`DolarAPI respondio con HTTP ${response.status}.`);
      }

      const payload = this.parsePayload(raw);
      const rate: ExchangeRate = {
        kind,
        value: payload.venta,
        casa: payload.casa,
        name: payload.nombre,
        fetchedAt: new Date().toISOString(),
        providerUpdatedAt: payload.fechaActualizacion,
      };

      this.cache.set(kind, {
        rate,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return rate;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("DolarAPI no respondio dentro del tiempo permitido.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parsePayload(raw: unknown): DolarApiPayload {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("DolarAPI no devolvio una respuesta valida.");
    }

    const data = raw as Record<string, unknown>;
    const venta = Number(data.venta);
    if (!Number.isFinite(venta) || venta <= 0) {
      throw new Error("DolarAPI devolvio una cotizacion de venta invalida.");
    }

    return {
      venta,
      casa: typeof data.casa === "string" ? data.casa : null,
      nombre: typeof data.nombre === "string" ? data.nombre : null,
      fechaActualizacion:
        typeof data.fechaActualizacion === "string" ? data.fechaActualizacion : null,
    };
  }
}
