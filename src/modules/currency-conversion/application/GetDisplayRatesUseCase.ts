import { AdminSettingsService } from "../../marketplace/application/AdminSettingsService";
import {
  isUsdArsRateKind,
  type IExchangeRateProvider,
  type UsdArsRateKind,
} from "../domain/CurrencyConversion";

export class GetDisplayRatesUseCase {
  constructor(private readonly exchangeRateProvider: IExchangeRateProvider) {}

  async execute() {
    const settings = await AdminSettingsService.getSettings();
    const rateKind: UsdArsRateKind = isUsdArsRateKind(settings.usdArsRateKind)
      ? settings.usdArsRateKind
      : "blue";
    const [usdArs, brlArs] = await Promise.all([
      this.exchangeRateProvider.getUsdArsRate(rateKind),
      this.exchangeRateProvider.getBrlArsRate(),
    ]);
    const usdBrl = usdArs.value / brlArs.value;

    if (!Number.isFinite(usdBrl) || usdBrl <= 0) {
      throw new Error("DolarAPI no devolvio tasas suficientes para calcular BRL.");
    }

    return {
      baseCurrency: "USD" as const,
      rates: {
        USD: 1,
        ARS: usdArs.value,
        BRL: usdBrl,
      },
      usdArsRateKind: rateKind,
      side: "venta" as const,
      source: "DOLARAPI" as const,
      quotedAt: new Date().toISOString(),
      sourcesUpdatedAt: {
        usdArs: usdArs.providerUpdatedAt,
        brlArs: brlArs.providerUpdatedAt,
      },
    };
  }
}
