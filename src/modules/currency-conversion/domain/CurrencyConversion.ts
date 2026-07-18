export const DISPLAY_CURRENCIES = ["USD", "ARS", "BRL"] as const;
export const USD_ARS_RATE_KINDS = ["oficial", "blue", "cripto"] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
export type UsdArsRateKind = (typeof USD_ARS_RATE_KINDS)[number];

export interface ExchangeRate<TKind extends string = string> {
  kind: TKind;
  value: number;
  casa: string | null;
  name: string | null;
  fetchedAt: string;
  providerUpdatedAt: string | null;
}

export interface IExchangeRateProvider {
  getUsdArsRate(kind: UsdArsRateKind): Promise<ExchangeRate<UsdArsRateKind>>;
  getBrlArsRate(): Promise<ExchangeRate<"brl">>;
}

export const isDisplayCurrency = (value: unknown): value is DisplayCurrency =>
  DISPLAY_CURRENCIES.includes(value as DisplayCurrency);

export const isUsdArsRateKind = (value: unknown): value is UsdArsRateKind =>
  USD_ARS_RATE_KINDS.includes(value as UsdArsRateKind);
