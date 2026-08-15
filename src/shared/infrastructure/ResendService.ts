import { config } from "../config";
import { AdminSecureConfigService } from "../../modules/marketplace/application/AdminSecureConfigService";

interface NotificationLike {
  title: string;
  content: string;
  type: string;
  link: string | null;
}

const ADMIN_NOTIFICATION_TITLES: Record<string, string> = {
  "notifications.newQuote.title": "Nueva Solicitud de Cotización",
  "notifications.newReview.title": "Nueva reseña para revisar",
  "notifications.newBuyOrder.title": "Nueva Orden de Compra",
  "notifications.newSellOrder.title": "Nueva Solicitud de Venta",
  "notifications.newRaffleChancesOrder.title": "Nueva compra de chances",
  "notifications.newTicket.title": "Nuevo ticket de soporte",
  "notifications.ticketAlert": "Mensaje de Soporte",
  "notifications.retentionExpiredAdmin.title": "Retención Vencida - Transferir Ahora",
  "notifications.sellRetentionAdmin.title": "Ítems en Retención",
  "notifications.sellRequotedAdmin.title": "Re-tasa Enviada",
  "notifications.sellRequoteApprovedAdmin.title": "Re-tasa Aprobada por Cliente",
  "notifications.sellRequoteRejectedAdmin.title": "Re-tasa Rechazada por Cliente",
};

const ADMIN_NOTIFICATION_CONTENTS: Record<string, string> = {
  "notifications.newQuote.content":
    "El usuario {userName} ha solicitado la cotización de {itemCount} ítems.",
  "notifications.newReview.content":
    "{userName} dejó una reseña para la comunidad.",
  "notifications.newBuyOrder.content":
    "El usuario {userName} ha realizado una compra por {totalPrice} USD.",
  "notifications.newSellOrder.content":
    "El usuario {userName} ha creado una nueva orden de venta por {totalPrice} USD.",
  "notifications.newRaffleChancesOrder.content":
    '{userName} compró {ticketsCount} chances para "{raffleName}" ({totalPrice} USD).',
  "notifications.newTicket.content": "{userName}: {subject}",
  "notifications.newTicketMessage.content": "{senderName}: {message}",
  "notifications.retentionExpiredAdmin.content":
    'La retención de 8 días de la orden #{orderId} de {sellerName} ha finalizado. Debe realizarse la transferencia de {amount} USD por "{itemName}".',
  "notifications.sellRetentionAdmin.content":
    "Orden de venta #{orderId} cambió a retención. Se inició el contador de 8 días.",
  "notifications.sellRequotedAdmin.content":
    "Se envió una nueva propuesta de cotización de {newPrice} USD para la orden #{orderId}.",
  "notifications.sellRequoteApprovedAdmin.content":
    "El cliente aprobó la propuesta de {newPrice} USD para la orden #{orderId}.",
  "notifications.sellRequoteRejectedAdmin.content":
    "El cliente rechazó la propuesta para la orden #{orderId} y canceló la venta.",
};

function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}

function resolveTitle(notification: NotificationLike): string {
  return ADMIN_NOTIFICATION_TITLES[notification.title] || notification.title;
}

function resolveContent(notification: NotificationLike): string {
  try {
    const parsed = JSON.parse(notification.content);
    if (parsed && typeof parsed === "object" && typeof parsed.key === "string") {
      const template = ADMIN_NOTIFICATION_CONTENTS[parsed.key];
      if (template) {
        return interpolate(template, (parsed.params as Record<string, unknown>) || {});
      }
    }
  } catch {
    // content is plain text
  }
  return notification.content;
}

function resolveFromEmail(from: string): string {
  const trimmed = from.trim();
  const bracketMatch = trimmed.match(/<([^<>]+)>/);
  const inner = bracketMatch?.[1]?.trim();
  const email = inner || trimmed;
  return `JabbuStore <${email}>`;
}

function buildEmailText(notification: NotificationLike): string {
  const lines = [
    resolveTitle(notification),
    "",
    resolveContent(notification),
  ];

  if (notification.link) {
    const baseUrl = (config.frontendUrl || "").replace(/\/+$/, "");
    const path = notification.link.startsWith("/")
      ? notification.link
      : `/${notification.link}`;
    lines.push("", `Enlace: ${baseUrl}/es${path}`);
  }

  return lines.join("\n");
}

export class ResendService {
  static async sendNotificationEmail(notification: NotificationLike): Promise<void> {
    try {
      const [token, from, fixedTo] = await Promise.all([
        AdminSecureConfigService.getSecretValue("RESEND_TOKEN"),
        AdminSecureConfigService.getSecretValue("RESEND_FROM"),
        AdminSecureConfigService.getSecretValue("RESEND_TO"),
      ]);

      console.log("[ResendService] Configuración leída:", {
        tokenConfigured: Boolean(token),
        tokenLast4: token ? token.slice(-4) : null,
        from,
        to: fixedTo,
      });

      if (!token || !from) {
        console.warn("[ResendService] RESEND_TOKEN o RESEND_FROM no configurados. Email omitido.");
        return;
      }

      const recipient = fixedTo.trim();

      if (!recipient) {
        console.warn("[ResendService] RESEND_TO no configurado. Email omitido.");
        return;
      }

      const resendModule = await import("resend");
      const resend = new resendModule.Resend(token);
      const result = await resend.emails.send({
        from: resolveFromEmail(from),
        to: [recipient],
        subject: `JabbuStore - ${resolveTitle(notification)}`,
        text: buildEmailText(notification),
      });

      if (result.error) {
        console.error("[ResendService] Resend devolvió error:", result.error);
        return;
      }

      console.log("[ResendService] Email enviado:", result.data);
    } catch (error) {
      console.error("[ResendService] Error enviando email de notificación:", error);
    }
  }
}
