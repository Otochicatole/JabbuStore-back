export class PayPalService {
  private static getCredentials() {
    return {
      clientId: process.env.PAYPAY_CLIENT_ID || "",
      clientSecret: process.env.PAYPAY_CLIENT_SECRET || "",
      isSandbox: process.env.PAYPAL_SANDBOX !== "false",
    };
  }

  /**
   * Obtiene un token de acceso OAuth 2.0 de PayPal.
   */
  public static async getAccessToken(): Promise<string> {
    const { clientId, clientSecret, isSandbox } = this.getCredentials();
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const baseUrl = isSandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const data: any = await response.json();
    if (!response.ok) {
      throw new Error(data?.error_description || "Error de autenticación con PayPal.");
    }

    return data.access_token;
  }

  /**
   * Crea una orden en PayPal de forma segura.
   * Garantiza la correspondencia exacta de los ítems y precios de la compra.
   */
  static async createOrder(
    order: any,
    frontendUrl: string,
    backendUrl: string,
  ): Promise<string> {
    const { clientId, clientSecret, isSandbox } = this.getCredentials();
    if (!clientId || !clientSecret) {
      throw new Error(
        "Las credenciales de PayPal (PAYPAY_CLIENT_ID / PAYPAY_CLIENT_SECRET) no están configuradas.",
      );
    }

    const accessToken = await this.getAccessToken();
    const baseUrl = isSandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

    const totalAmount = order.totalPrice;

    // Estructurar ítems para PayPal (redondeado a 2 decimales)
    const items = order.items.map((item: any) => ({
      name: item.name.slice(0, 127), // PayPal limita el nombre del item a 127 caracteres
      quantity: "1",
      unit_amount: {
        currency_code: "USD",
        value: (Math.round(Number(item.price) * 100) / 100).toFixed(2),
      },
    }));

    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: order.id,
          amount: {
            currency_code: "USD",
            value: totalAmount.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: "USD",
                value: totalAmount.toFixed(2),
              },
            },
          },
          items,
        },
      ],
      application_context: {
        return_url: `${frontendUrl}/checkout?status=success&orderId=${order.id}&method=paypal`,
        cancel_url: `${frontendUrl}/checkout?status=failure&orderId=${order.id}&method=paypal`,
        user_action: "PAY_NOW",
        brand_name: "JabbuStore",
      },
    };

    console.log(
      `[PayPal] Creando orden para Orden ID: ${order.id}. Sandbox: ${isSandbox}`,
    );

    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data: any = await response.json();

    if (!response.ok) {
      throw new Error(data?.message || "Error al crear la orden de PayPal.");
    }

    // Buscar el link de aprobación (approve link) para redirigir al usuario
    const approveLink = data.links?.find((link: any) => link.rel === "approve");

    if (!approveLink) {
      throw new Error("PayPal no devolvió el enlace de aprobación (approve link).");
    }

    return approveLink.href;
  }

  /**
   * Captura el pago de una orden previamente aprobada por el usuario.
   * Se utiliza tanto para verificar el pago de forma manual como asíncrona.
   */
  static async capturePayment(paypalOrderId: string): Promise<any> {
    const { isSandbox } = this.getCredentials();
    const accessToken = await this.getAccessToken();
    const baseUrl = isSandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

    console.log(`[PayPal] Capturando pago de la Orden PayPal ID: ${paypalOrderId}`);

    const response = await fetch(`${baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data: any = await response.json();

    if (!response.ok) {
      throw new Error(data?.message || "Error al capturar el pago en PayPal.");
    }

    return data;
  }
}
