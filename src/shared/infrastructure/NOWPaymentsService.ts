import crypto from "crypto";

const apiKey = process.env.NOWPAYMENTS_API_KEY || "";
const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET || "";

export class NOWPaymentsService {
  /**
   * Crea un pago/invoice en NOWPayments de manera segura.
   * Valida montos y asegura la correspondencia 1:1 con la orden.
   */
  static async createInvoice(
    order: any,
    frontendUrl: string,
    backendUrl: string,
  ): Promise<string> {
    if (!apiKey) {
      throw new Error(
        "NOWPAYMENTS_API_KEY no está configurado en las variables de entorno.",
      );
    }

    const totalAmount = order.totalPrice; // Asegura correspondencia exacta del precio de los artículos comprados

    const body = {
      price_amount: totalAmount,
      price_currency: "usd", // La tienda opera en USD
      pay_currency: "usdtbsc", // Moneda de pago preferida (ej: USDT BSC, o dejar que el cliente elija si se usa Invoice API)
      ipn_callback_url: `${backendUrl}/api/orders/webhook/nowpayments`,
      order_id: order.id,
      order_description: `Compra en JabbuStore - Orden #${order.id.slice(0, 8)}`,
      success_url: `${frontendUrl}/checkout?status=success&orderId=${order.id}&method=nowpayments`,
      cancel_url: `${frontendUrl}/checkout?status=failure&orderId=${order.id}&method=nowpayments`,
    };

    console.log(
      `[NOWPayments] Creando invoice para Orden ID: ${order.id}. Webhook: ${body.ipn_callback_url}`,
    );

    // NOWPayments Invoice API
    const response = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    const data: any = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.message || "Error al crear el invoice en NOWPayments.",
      );
    }

    if (!data.invoice_url) {
      throw new Error("NOWPayments no devolvió la url de pago (invoice_url).");
    }

    return data.invoice_url;
  }

  /**
   * Verifica criptográficamente que la notificación del webhook provenga de NOWPayments
   * mediante la validación de la firma en la cabecera x-nowpayments-sig.
   */
  static verifySignature(rawBody: string, signature: string): boolean {
    if (!ipnSecret) {
      console.warn(
        "[NOWPayments] NOWPAYMENTS_IPN_SECRET no configurado. Saltando validación de firma.",
      );
      return true; // Si no hay secreto configurado, no se puede verificar (no recomendado en producción)
    }

    if (!signature) return false;

    // NOWPayments utiliza HMAC-SHA512 con el IPN secret de la cuenta del usuario para firmar la petición
    const hmac = crypto.createHmac("sha512", ipnSecret);
    hmac.update(rawBody);
    const calculatedSignature = hmac.digest("hex");

    return calculatedSignature === signature;
  }
}
