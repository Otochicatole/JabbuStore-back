import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { Order } from '../domain/Order';
import crypto from 'node:crypto';

export class WebhookService {
  /**
   * Sends a webhook notification in the background
   */
  static async sendOrderNotification(order: Order, event: 'order.created' | 'order.status_updated') {
    try {
      const settings = await prisma.adminSettings.findFirst();
      const webhookUrl = settings?.webhookUrl;

      if (!webhookUrl) {
        console.log(`[WebhookService] WebhookUrl not configured. Skipping event: ${event}`);
        return;
      }

      console.log(`[WebhookService] Dispatching event "${event}" for order ${order.id} to: ${webhookUrl}`);

      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data: {
          id: order.id,
          userId: order.userId,
          type: order.type,
          status: order.status,
          totalPrice: order.totalPrice,
          paymentMethod: (order as any).paymentMethod || null,
          items: order.items.map(item => ({
            id: item.id,
            assetId: item.assetId,
            name: item.name,
            price: item.price,
            iconUrl: item.iconUrl || null,
          })),
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        }
      };
      const body = JSON.stringify(payload);
      const signingSecret = process.env.OUTBOUND_WEBHOOK_SECRET;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'JabbuStore-Webhook-Agent/1.0',
      };

      if (signingSecret) {
        headers['X-Jabbu-Signature'] = crypto
          .createHmac('sha256', signingSecret)
          .update(body)
          .digest('hex');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      // Disparar la petición sin bloquear el hilo principal (en segundo plano)
      fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: controller.signal,
      })
        .then(async (response) => {
          clearTimeout(timeout);
          if (response.ok) {
            console.log(`[WebhookService] Webhook dispatched successfully! Status: ${response.status}`);
          } else {
            const errorText = await response.text().catch(() => '');
            console.error(`[WebhookService] Webhook returned error status ${response.status}: ${errorText}`);
          }
        })
        .catch((error) => {
          clearTimeout(timeout);
          console.error(`[WebhookService] Connection failed for webhook dispatcher:`, error.message || error);
        });

    } catch (err: any) {
      console.error('[WebhookService] Error building webhook payload:', err.message || err);
    }
  }
}
