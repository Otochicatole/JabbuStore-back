import {
  type ExchangeRate,
  type IExchangeRateProvider,
  type UsdArsRateKind,
} from "../domain/PaymentQuote";

const DOLAR_API_BASE_URL = "https://dolarapi.com";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

type CacheEntry = {
  expiresAt: number;
  rate: ExchangeRate;
};

export class DolarApiExchangeRateProvider implements IExchangeRateProvider {
  private cache = new Map<UsdArsRateKind, CacheEntry>();

  async getUsdArsRate(kind: UsdArsRateKind): Promise<ExchangeRate> {
    const cached = this.cache.get(kind);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rate;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${DOLAR_API_BASE_URL}/v1/dolares/${kind}`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      const data: any = await response.json().catch(() => null);
      if (!response.ok || !data) {
        throw new Error(data?.message || "DolarAPI no devolvió una cotización válida.");
      }

      const venta = Number(data.venta);
      if (!Number.isFinite(venta) || venta <= 0) {
        throw new Error("DolarAPI devolvió una cotización de venta inválida.");
      }

      const rate: ExchangeRate = {
        kind,
        value: venta,
        casa: typeof data.casa === "string" ? data.casa : null,
        name: typeof data.nombre === "string" ? data.nombre : null,
        fetchedAt: new Date().toISOString(),
        providerUpdatedAt:
          typeof data.fechaActualizacion === "string" ? data.fechaActualizacion : null,
      };

      this.cache.set(kind, {
        rate,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return rate;
    } finally {
      clearTimeout(timeout);
    }
  }
}
