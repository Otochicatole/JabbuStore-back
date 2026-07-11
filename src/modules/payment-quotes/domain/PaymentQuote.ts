export const USD_ARS_RATE_KINDS = ["oficial", "blue", "cripto"] as const;

export type UsdArsRateKind = (typeof USD_ARS_RATE_KINDS)[number];
export type SettlementCurrency = "ARS" | "USD" | "USDT";
export type PaymentQuotePurpose = "payment_quote";

export interface MoneyAmount {
  currency: "USD" | SettlementCurrency;
  amount: number;
}

export interface ExchangeRateSnapshot {
  source: "DOLARAPI";
  kind: UsdArsRateKind;
  side: "venta";
  value: number;
  casa: string | null;
  name: string | null;
  fetchedAt: string;
  providerUpdatedAt: string | null;
}

export interface PaymentQuoteSnapshot {
  base: MoneyAmount & { currency: "USD" };
  settlement: MoneyAmount;
  rate: ExchangeRateSnapshot | null;
  paymentMethod: string;
  manualTransferType: "bank" | "crypto" | null;
  quotedAt: string;
  expiresAt: string | null;
}

export interface ExchangeRate {
  kind: UsdArsRateKind;
  value: number;
  casa: string | null;
  name: string | null;
  fetchedAt: string;
  providerUpdatedAt: string | null;
}

export interface IExchangeRateProvider {
  getUsdArsRate(kind: UsdArsRateKind): Promise<ExchangeRate>;
}

export interface PaymentQuoteTokenPayload {
  purpose: PaymentQuotePurpose;
  sub: string;
  baseAmount: number;
  paymentMethod: string;
  manualTransferType: "bank" | "crypto" | null;
  snapshot: PaymentQuoteSnapshot;
}

export const isUsdArsRateKind = (value: unknown): value is UsdArsRateKind => {
  return USD_ARS_RATE_KINDS.includes(value as UsdArsRateKind);
};

export const isArsSettlementMethod = (
  paymentMethod: string | null | undefined,
  manualTransferType?: string | null,
) => {
  return (
    paymentMethod === "mercado_pago" ||
    (paymentMethod === "manual_transfer" && manualTransferType === "bank")
  );
};

export const getSettlementCurrencyForMethod = (
  paymentMethod: string | null | undefined,
  manualTransferType?: string | null,
): SettlementCurrency => {
  if (isArsSettlementMethod(paymentMethod, manualTransferType)) return "ARS";
  if (paymentMethod === "manual_transfer" && manualTransferType === "crypto") return "USDT";
  return "USD";
};

export const readPaymentQuoteSnapshot = (
  metadata: unknown,
): PaymentQuoteSnapshot | null => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const quote = (metadata as Record<string, unknown>).paymentQuote;
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) {
    return null;
  }

  const record = quote as Record<string, any>;
  const baseAmount = Number(record.base?.amount);
  const settlementAmount = Number(record.settlement?.amount);
  const settlementCurrency = record.settlement?.currency;

  if (
    record.base?.currency !== "USD" ||
    !Number.isFinite(baseAmount) ||
    !Number.isFinite(settlementAmount) ||
    (settlementCurrency !== "ARS" &&
      settlementCurrency !== "USD" &&
      settlementCurrency !== "USDT")
  ) {
    return null;
  }

  return {
    base: { currency: "USD", amount: baseAmount },
    settlement: {
      currency: settlementCurrency,
      amount: settlementAmount,
    },
    rate: record.rate ?? null,
    paymentMethod: String(record.paymentMethod || ""),
    manualTransferType:
      record.manualTransferType === "bank" || record.manualTransferType === "crypto"
        ? record.manualTransferType
        : null,
    quotedAt: String(record.quotedAt || ""),
    expiresAt: record.expiresAt ? String(record.expiresAt) : null,
  };
};
