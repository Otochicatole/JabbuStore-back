import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

// Inicializar el SDK oficial de Mercado Pago
const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || "";

export const mpConfig = new MercadoPagoConfig({
  accessToken: accessToken,
  options: { timeout: 5000 },
});

export class MercadoPagoService {
  /**
   * Crea una preferencia de Checkout Pro para una orden del sistema de forma segura.
   * Calcula el precio y los datos del lado del servidor usando la API de Mercado Pago.
   */
  static async createPreference(
    order: any,
    frontendUrl: string,
    backendUrl: string,
  ): Promise<string> {
    if (!accessToken) {
      throw new Error(
        "MERCADOPAGO_ACCESS_TOKEN no está configurado en las variables de entorno.",
      );
    }

    const preferenceClient = new Preference(mpConfig);

    // Mapear los ítems de la orden para Mercado Pago (con redondeo a 2 decimales para evitar fallos de API)
    const items = order.items.map((item: any) => ({
      id: item.assetId,
      title: item.name,
      quantity: 1,
      unit_price: Math.round(Number(item.price) * 100) / 100,
      currency_id: "ARS", // Mercado Pago opera por defecto en ARS en Argentina, o USD según tu cuenta
    }));

    const preferenceBody: any = {
      items,
      external_reference: order.id, // ID de nuestra orden para asociar en el webhook
      back_urls: {
        success: `${frontendUrl}/checkout?status=success&orderId=${order.id}`,
        failure: `${frontendUrl}/checkout?status=failure`,
        pending: `${frontendUrl}/checkout?status=pending`,
      },
      auto_return: "approved",
      metadata: {
        order_id: order.id,
        user_id: order.userId,
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
    const paymentClient = new Payment(mpConfig);
    console.log(
      `[Mercado Pago] Verificando detalles del Pago ID: ${paymentId}`,
    );
    return await paymentClient.get({ id: paymentId });
  }
}
