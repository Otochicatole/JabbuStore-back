import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import { config } from "../../../shared/config";
import { roundMoney } from "../../orders/application/OrderPricingService";
import { AdminSettingsService } from "../../marketplace/application/AdminSettingsService";
import {
  getSettlementCurrencyForMethod,
  isArsSettlementMethod,
  isUsdArsRateKind,
  type IExchangeRateProvider,
  type PaymentQuoteSnapshot,
  type PaymentQuoteTokenPayload,
  type UsdArsRateKind,
} from "../domain/PaymentQuote";
import {
  CheckoutBaseAmountInput,
  CheckoutBaseAmountResolver,
} from "./CheckoutBaseAmountResolver";

const PAYMENT_QUOTE_TTL_SECONDS = 10 * 60;
const PAYMENT_AMOUNT_TOLERANCE = 0.01;

export interface CreatePaymentQuoteInput extends CheckoutBaseAmountInput {
  userId: string;
  paymentMethod: string;
  manualTransferType?: "bank" | "crypto" | null;
}

export interface VerifyPaymentQuoteInput {
  token: string | null | undefined;
  userId: string;
  paymentMethod: string;
  manualTransferType?: "bank" | "crypto" | null;
  baseAmount: number;
}

export class PaymentQuoteTokenService {
  private getSecret() {
    const secret = config.jwtSecret || config.sessionSecret || process.env.JWT_SECRET || process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error("PAYMENT_QUOTE_SECRET_MISSING");
    }
    return secret;
  }

  sign(payload: PaymentQuoteTokenPayload): string {
    return jwt.sign(payload, this.getSecret(), {
      expiresIn: PAYMENT_QUOTE_TTL_SECONDS,
      audience: "payment-quote",
    });
  }

  verify(token: string): (PaymentQuoteTokenPayload & JwtPayload) | null {
    try {
      const payload = jwt.verify(token, this.getSecret(), {
        audience: "payment-quote",
      });
      if (!payload || typeof payload !== "object") return null;
      return payload as PaymentQuoteTokenPayload & JwtPayload;
    } catch {
      return null;
    }
  }
}

export class CreatePaymentQuoteUseCase {
  constructor(
    private checkoutBaseAmountResolver: CheckoutBaseAmountResolver,
    private exchangeRateProvider: IExchangeRateProvider,
    private tokenService: PaymentQuoteTokenService,
  ) {}

  async execute(input: CreatePaymentQuoteInput) {
    const baseAmount = await this.checkoutBaseAmountResolver.resolve(input);
    const manualTransferType = input.manualTransferType ?? null;
    const settlementCurrency = getSettlementCurrencyForMethod(
      input.paymentMethod,
      manualTransferType,
    );
    const quotedAt = new Date();

    let snapshot: PaymentQuoteSnapshot = {
      base: { currency: "USD", amount: baseAmount },
      settlement: { currency: settlementCurrency, amount: baseAmount },
      rate: null,
      paymentMethod: input.paymentMethod,
      manualTransferType,
      quotedAt: quotedAt.toISOString(),
      expiresAt: null,
    };

    if (isArsSettlementMethod(input.paymentMethod, manualTransferType)) {
      const settings = await AdminSettingsService.getSettings();
      const rateKind = normalizeRateKind(settings.usdArsRateKind);
      const rate = await this.exchangeRateProvider.getUsdArsRate(rateKind);
      const expiresAt = new Date(quotedAt.getTime() + PAYMENT_QUOTE_TTL_SECONDS * 1000);

      snapshot = {
        ...snapshot,
        settlement: {
          currency: "ARS",
          amount: roundMoney(baseAmount * rate.value),
        },
        rate: {
          source: "DOLARAPI",
          kind: rate.kind,
          side: "venta",
          value: rate.value,
          casa: rate.casa,
          name: rate.name,
          fetchedAt: rate.fetchedAt,
          providerUpdatedAt: rate.providerUpdatedAt,
        },
        expiresAt: expiresAt.toISOString(),
      };

      const quoteToken = this.tokenService.sign({
        purpose: "payment_quote",
        sub: input.userId,
        baseAmount,
        paymentMethod: input.paymentMethod,
        manualTransferType,
        snapshot,
      });

      return {
        ...snapshot,
        quoteToken,
      };
    }

    return snapshot;
  }
}

export class VerifyPaymentQuoteUseCase {
  constructor(private tokenService: PaymentQuoteTokenService) {}

  execute(input: VerifyPaymentQuoteInput): PaymentQuoteSnapshot {
    if (!input.token) {
      throw new Error("La cotización ARS expiró o no está disponible. Refrescá el checkout e intentá nuevamente.");
    }

    const payload = this.tokenService.verify(input.token);
    if (!payload || payload.purpose !== "payment_quote") {
      throw new Error("La cotización ARS no es válida. Refrescá el checkout e intentá nuevamente.");
    }

    const manualTransferType = input.manualTransferType ?? null;
    if (
      payload.sub !== input.userId ||
      payload.paymentMethod !== input.paymentMethod ||
      payload.manualTransferType !== manualTransferType
    ) {
      throw new Error("La cotización ARS no coincide con el método de pago seleccionado.");
    }

    if (
      !payload.snapshot ||
      payload.snapshot.settlement.currency !== "ARS" ||
      Math.abs(Number(payload.baseAmount) - input.baseAmount) > PAYMENT_AMOUNT_TOLERANCE
    ) {
      throw new Error("El precio cambió desde la cotización. Refrescá el checkout e intentá nuevamente.");
    }

    return payload.snapshot;
  }
}

const normalizeRateKind = (value: unknown): UsdArsRateKind => {
  return isUsdArsRateKind(value) ? value : "blue";
};
