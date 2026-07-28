import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { PrismaNotificationRepository } from "../../notifications/infrastructure/PrismaNotificationRepository";
import { CreateOrUpdateNotificationUseCase } from "../../notifications/application/NotificationUseCases";

const RETENTION_DAYS = 8;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Checks sell orders in RETENTION state. When the 8-day retention period
 * has expired, it sends an admin notification alerting them to make the transfer.
 * Runs every 5 minutes.
 */
async function checkExpiredRetentions() {
  try {
    // Find all orders that are still in RETENTION status
    const retentionOrders = await prisma.order.findMany({
      where: {
        type: "SELL",
        status: "RETENTION",
      },
      select: {
        id: true,
        totalPrice: true,
        metadata: true,
        userId: true,
        user: {
          select: { name: true, email: true }
        },
        items: {
          select: { name: true },
          take: 1,
        }
      },
    });

    if (retentionOrders.length === 0) return;

    const now = Date.now();
    const notificationRepo = new PrismaNotificationRepository();
    const notificationUseCase = new CreateOrUpdateNotificationUseCase(notificationRepo);

    for (const order of retentionOrders) {
      const meta = order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata)
        ? (order.metadata as Record<string, any>)
        : {};

      const retentionStartedAt = meta.retentionStartedAt;

      // Skip if no retention start timestamp
      if (!retentionStartedAt) continue;

      const startMs = new Date(retentionStartedAt as string).getTime();
      const elapsed = now - startMs;

      // Check if 8 days have passed AND we haven't already sent the expiry notification
      if (elapsed >= RETENTION_MS && !meta.retentionExpiredNotified) {
        console.log(`[RetentionScheduler] Retention period expired for order ${order.id}. Notifying admin.`);

        const firstItemName = order.items[0]?.name || "ítem";
        const sellerName = order.user?.name || "Usuario";

        // Send admin notification
        await notificationUseCase.execute({
          userId: null,
          adminId: null,
          title: "notifications.retentionExpiredAdmin.title",
          content: JSON.stringify({
            key: "notifications.retentionExpiredAdmin.content",
            params: {
              orderId: order.id.slice(0, 8),
              sellerName,
              itemName: firstItemName,
              amount: Number(order.totalPrice).toFixed(2),
            }
          }),
          type: "ORDER_STATUS",
          link: `/admin/panel/orders/listing?id=${order.id}`,
        });

        // Also notify the client
        await notificationUseCase.execute({
          userId: order.userId,
          adminId: null,
          title: "notifications.retentionExpiredUser.title",
          content: JSON.stringify({
            key: "notifications.retentionExpiredUser.content",
            params: {
              orderId: order.id.slice(0, 8),
              amount: Number(order.totalPrice).toFixed(2),
            }
          }),
          type: "ORDER_STATUS",
          link: "/listings",
        });

        // Mark as notified in metadata so we don't spam
        await prisma.order.update({
          where: { id: order.id },
          data: {
            metadata: { ...meta, retentionExpiredNotified: true },
          },
        });
      }
    }
  } catch (err) {
    console.error("[RetentionScheduler] Error checking expired retentions:", err);
  }
}

/**
 * Starts the retention expiry scheduler.
 * Runs every 5 minutes to check for orders whose retention period has ended.
 */
export function startRetentionScheduler() {
  const intervalMs = 5 * 60 * 1000; // 5 minutes

  console.log("[Retention Scheduler] Starting retention expiry scheduler. Interval: 5min");

  // Initial check on startup
  checkExpiredRetentions();

  setInterval(checkExpiredRetentions, intervalMs);
}
