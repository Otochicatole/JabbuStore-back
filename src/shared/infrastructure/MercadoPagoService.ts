import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { AdminSecureConfigService } from "../../modules/marketplace/application/AdminSecureConfigService";
import { readPaymentQuoteSnapshot } from "../../modules/payment-quotes/domain/PaymentQuote";

export class MercadoPagoService {
  private static async getClientConfig() {
    const accessToken = await AdminSecureConfigService.getSecretValue("MERCADOPAGO_ACCESS_TOKEN");
    if (!accessToken) {
      throw new Error(
        "MERCADOPAGO_ACCESS_TOKEN no está configurado en secretos admin ni variables de entorno.",
      );
    }

    return new MercadoPagoConfig({
      accessToken,
      options: { timeout: 5000 },
    });
  }

  /**
   * Crea una preferencia de Checkout Pro para una orden del sistema de forma segura.
   * Calcula el precio y los datos del lado del servidor usando la API de Mercado Pago.
   */
  static async createPreference(
    order: any,
    frontendUrl: string,
    backendUrl: string,
  ): Promise<string> {
    const preferenceClient = new Preference(await this.getClientConfig());
    const paymentQuote = readPaymentQuoteSnapshot(order.metadata);
    if (!paymentQuote || paymentQuote.settlement.currency !== "ARS") {
      throw new Error("La orden no tiene una cotización ARS válida para Mercado Pago.");
    }

    const settlementAmount = Math.round(Number(paymentQuote.settlement.amount) * 100) / 100;
    if (!Number.isFinite(settlementAmount) || settlementAmount <= 0) {
      throw new Error("La cotización ARS de Mercado Pago tiene un monto inválido.");
    }

    const items = [
      {
        id: order.id,
        title: `Compra JabbuStore #${String(order.id).slice(0, 8)}`,
        quantity: 1,
        unit_price: settlementAmount,
        currency_id: "ARS",
      },
    ];

    const preferenceBody: any = {
      items,
      external_reference: order.id, // ID de nuestra orden para asociar en el webhook
      back_urls: {
        success: `${frontendUrl}/checkout?status=success&orderId=${order.id}&method=mercado_pago`,
        failure: `${frontendUrl}/checkout?status=failure&orderId=${order.id}&method=mercado_pago`,
        pending: `${frontendUrl}/checkout?status=pending&orderId=${order.id}&method=mercado_pago`,
      },
      auto_return: "approved",
      metadata: {
        order_id: order.id,
        user_id: order.userId,
        base_amount_usd: paymentQuote.base.amount,
        settlement_amount_ars: paymentQuote.settlement.amount,
        rate_kind: paymentQuote.rate?.kind,
      },
    };

    // Mercado Pago requiere una URL HTTPS pública para las notificaciones de Webhook.
    // Evitamos enviar localhost para que no falle la creación de la preferencia en desarrollo.
    if (
      backendUrl &&
      !backendUrl.includes("localhost") &&
      !backendUrl.includes("127.0.0.1")
    ) {
      preferenceBody.notification_url = `${backendUrl}/api/orders/webhook/mercadopago`;
    }

    const preferenceData = {
      body: preferenceBody,
    };

    console.log(
      `[Mercado Pago] Creando preferencia para Orden ID: ${order.id}. Webhook: ${preferenceBody.notification_url || "OMITIDO (Localhost)"}`,
    );
    const preference = await preferenceClient.create(preferenceData);

    if (!preference.init_point) {
      throw new Error("Mercado Pago no devolvió el init_point de pago.");
    }

    return preference.init_point;
  }

  /**
   * Obtiene los detalles de un pago directamente desde Mercado Pago de forma segura para validar el estado.
   */
  static async getPaymentDetails(paymentId: string) {
    const paymentClient = new Payment(await this.getClientConfig());
    console.log(
      `[Mercado Pago] Verificando detalles del Pago ID: ${paymentId}`,
    );
    return await paymentClient.get({ id: paymentId });
  }
}
