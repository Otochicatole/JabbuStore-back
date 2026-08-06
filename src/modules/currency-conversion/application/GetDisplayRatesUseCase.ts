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
    const usdArs = await this.exchangeRateProvider.getUsdArsRate(rateKind);

    return {
      baseCurrency: "USD" as const,
      rates: {
        USD: 1,
        ARS: usdArs.value,
      },
      usdArsRateKind: rateKind,
      side: "venta" as const,
      source: "DOLARAPI" as const,
      quotedAt: new Date().toISOString(),
      sourcesUpdatedAt: {
        usdArs: usdArs.providerUpdatedAt,
      },
    };
  }
}
