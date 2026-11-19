import type { MailDataRequired, MailService } from "@sendgrid/mail";
import { config } from "../config";
import { AdminSecureConfigService } from "../../modules/marketplace/application/AdminSecureConfigService";

export interface NotificationLike {
  title: string;
  content: string;
  type: string;
  link: string | null;
}

export interface SendNotificationEmailResult {
  ok: boolean;
  id?: string | undefined;
  from?: string | undefined;
  to?: string[] | undefined;
  error?: string | undefined;
  statusCode?: number | null | undefined;
  skipped?: boolean | undefined;
}

export interface SendGridSenderIdentity {
  email: string;
  name: string;
}

const NOTIFICATION_TITLES: Record<string, string> = {
  "notifications.newQuote.title": "Nueva Solicitud de Cotización",
  "notifications.quoteAnswered.title": "Cotización respondida",
  "notifications.newReview.title": "Nueva reseña para revisar",
  "notifications.reviewThanks.title": "Gracias por tu reseña",
  "notifications.newBuyOrder.title": "Nueva Orden de Compra",
  "notifications.newSellOrder.title": "Nueva Solicitud de Venta",
  "notifications.newRaffleChancesOrder.title": "Nueva compra de chances",
  "notifications.orderPaymentConfirmedAdmin.title": "Orden Pagada - Lista para Trade",
  "notifications.rafflePaymentConfirmedAdmin.title": "Pago de Rifa Confirmado",
  "notifications.raffleChancesPurchased.title": "Compra de chances registrada",
  "notifications.raffleChancesApproved.title": "Chances confirmadas",
  "notifications.raffleChancesCancelled.title": "Compra de chances cancelada",
  "notifications.raffleWon.title": "¡Ganaste una rifa!",
  "notifications.participationDrawWon.title": "¡Ganaste el sorteo por participaciones!",
  "notifications.tradeReceived.title": "Trade recibido",
  "notifications.orderPaid.title": "Orden pagada con éxito",
  "notifications.sellCompleted.title": "Venta completada",
  "notifications.orderCompleted.title": "Orden completada",
  "notifications.sellCancelled.title": "Venta cancelada",
  "notifications.orderCancelled.title": "Orden cancelada",
  "notifications.sellApproved.title": "Venta aprobada",
  "notifications.tradePending.title": "Intercambio de Steam pendiente",
  "notifications.orderUpdated.title": "Estado de orden actualizado",
  "notifications.sellRetention.title": "Venta en Período de Retención",
  "notifications.sellRequoted.title": "Cotización Re-tasada",
  "notifications.sellRequoteApproved.title": "Re-tasa Aprobada",
  "notifications.sellRequoteRejected.title": "Re-tasa Rechazada",
  "notifications.newTicket.title": "Nuevo ticket de soporte",
  "notifications.ticketAlert": "Mensaje de Soporte",
  "notifications.retentionExpiredAdmin.title": "Retención Vencida - Transferir Ahora",
  "notifications.retentionExpiredUser.title": "Período de Retención Completado",
  "notifications.sellRetentionAdmin.title": "Ítems en Retención",
  "notifications.sellRequotedAdmin.title": "Re-tasa Enviada",
  "notifications.sellRequoteApprovedAdmin.title": "Re-tasa Aprobada por Cliente",
  "notifications.sellRequoteRejectedAdmin.title": "Re-tasa Rechazada por Cliente",
  "notifications.botAssigned.title": "Seguridad de Trade: Bot Asignado",
};

const NOTIFICATION_CONTENTS: Record<string, string> = {
  "notifications.newQuote.content":
    "El usuario {userName} ha solicitado la cotización de {itemCount} ítems.",
  "notifications.quoteAnswered.content":
    "El administrador ha cotizado los ítems de tu solicitud #{quoteId}.",
  "notifications.newReview.content":
    "{userName} dejó una reseña para la comunidad.",
  "notifications.reviewThanks.content":
    "Gracias por compartir tu experiencia con la comunidad.",
  "notifications.newBuyOrder.content":
    "El usuario {userName} ha realizado una compra por {totalPrice} USD.",
  "notifications.newSellOrder.content":
    "El usuario {userName} ha creado una nueva orden de venta por {totalPrice} USD.",
  "notifications.newRaffleChancesOrder.content":
    '{userName} compró {ticketsCount} chances para "{raffleName}" ({totalPrice} USD).',
  "notifications.orderPaymentConfirmedAdmin.content":
    "Se confirmó el pago de la orden #{orderId} de {userName} por {totalPrice} USD vía {provider}.",
  "notifications.rafflePaymentConfirmedAdmin.content":
    'Se confirmó el pago de {ticketsCount} chances en "{raffleName}" (orden #{orderId}) de {userName} por {totalPrice} USD vía {provider}.',
  "notifications.raffleChancesPurchased.content":
    'Tu orden #{orderId} por {ticketsCount} chances en "{raffleName}" está pendiente de confirmación.',
  "notifications.raffleChancesApproved.content":
    'Se acreditaron {ticketsCount} chances en "{raffleName}" (orden #{orderId}). ¡Buena suerte!',
  "notifications.raffleChancesCancelled.content":
    'Tu orden #{orderId} de chances para "{raffleName}" fue cancelada.',
  "notifications.raffleWon.content":
    '¡Felicitaciones! Ganaste "{prizeName}" en la rifa "{raffleName}".',
  "notifications.participationDrawWon.content":
    '¡Felicitaciones! Ganaste "{prizeName}" en el sorteo "{drawName}".',
  "notifications.tradeReceived.content":
    "Hemos recibido los ítems para tu orden de venta #{orderId}. En breve se te enviará el dinero.",
  "notifications.orderPaid.content":
    "Hemos recibido tu pago para la orden #{orderId}. ¡Gracias por tu compra!",
  "notifications.sellCompleted.content":
    "El pago para tu orden de venta #{orderId} ha sido enviado con éxito.",
  "notifications.orderCompleted.content":
    "La orden #{orderId} ha sido entregada y completada.",
  "notifications.sellCancelled.content":
    "Tu orden de venta #{orderId} ha sido cancelada.",
  "notifications.orderCancelled.content":
    "La orden #{orderId} ha sido cancelada.",
  "notifications.sellApproved.content":
    "Tu orden de venta #{orderId} ha sido aprobada. Por favor, acepta el trade.",
  "notifications.tradePending.content":
    "La orden #{orderId} está lista. Revisa tus ofertas de intercambio de Steam.",
  "notifications.orderUpdated.content":
    "El estado de tu orden #{orderId} cambió a {status}.",
  "notifications.sellRetention.content":
    "Tu orden de venta #{orderId} ha ingresado al período de retención de seguridad de 8 días antes del pago.",
  "notifications.sellRequoted.content":
    "Tu orden de venta #{orderId} fue re-tasada de {originalPrice} USD a {newPrice} USD debido al mercado. Aprobá o rechazá el nuevo valor.",
  "notifications.sellRequoteApproved.content":
    "Aprobaste la nueva tasación de {newPrice} USD para tu venta #{orderId}.",
  "notifications.sellRequoteRejected.content":
    "Rechazaste la re-tasa. Tu venta #{orderId} fue cancelada y los ítems serán devueltos.",
  "notifications.newTicket.content": "{userName}: {subject}",
  "notifications.newTicketMessage.content": "{senderName}: {message}",
  "notifications.retentionExpiredAdmin.content":
    'La retención de 8 días de la orden #{orderId} de {sellerName} ha finalizado. Debe realizarse la transferencia de {amount} USD por "{itemName}".',
  "notifications.retentionExpiredUser.content":
    "Los 8 días de retención de tu venta #{orderId} han terminado. El administrador procesará el pago de {amount} USD en breve.",
  "notifications.sellRetentionAdmin.content":
    "Orden de venta #{orderId} cambió a retención. Se inició el contador de 8 días.",
  "notifications.sellRequotedAdmin.content":
    "Se envió una nueva propuesta de cotización de {newPrice} USD para la orden #{orderId}.",
  "notifications.sellRequoteApprovedAdmin.content":
    "El cliente aprobó la propuesta de {newPrice} USD para la orden #{orderId}.",
  "notifications.sellRequoteRejectedAdmin.content":
    "El cliente rechazó la propuesta para la orden #{orderId} y canceló la venta.",
  "notifications.botAssigned.buyContent":
    "Tu trade será enviado por el bot oficial '{botName}' (Steam ID: {botSteamId}). Asegúrate de verificarlo.",
  "notifications.botAssigned.sellContent":
    "Por favor, envía el trade únicamente al bot oficial '{botName}' (Steam ID: {botSteamId}).",
};

const EMAIL_ADDRESS_REGEX = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MIN_SEND_INTERVAL_MS = 250;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 15000;
const REQUEST_TIMEOUT_MS = 15000;

let sendQueue: Promise<unknown> = Promise.resolve();
let lastSendStartedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function extractEmailAddress(raw: string): string | null {
  const cleaned = stripWrappingQuotes(raw);
  if (!cleaned) return null;

  const bracketMatch = cleaned.match(/<([^<>]+)>/);
  const candidate = stripWrappingQuotes(bracketMatch?.[1] ?? cleaned);
  if (!EMAIL_ADDRESS_REGEX.test(candidate)) {
    return null;
  }

  return candidate;
}

export function parseFromIdentity(from: string): SendGridSenderIdentity | null {
  const cleaned = stripWrappingQuotes(from);
  if (!cleaned) return null;

  const bracketMatch = cleaned.match(/^(.*?)<([^<>]+)>$/);
  if (bracketMatch) {
    const email = stripWrappingQuotes(bracketMatch[2] ?? "");
    if (!EMAIL_ADDRESS_REGEX.test(email)) {
      return null;
    }
    const rawName = stripWrappingQuotes(bracketMatch[1] ?? "");
    return {
      email,
      name: rawName || "JabbuStore",
    };
  }

  if (!EMAIL_ADDRESS_REGEX.test(cleaned)) {
    return null;
  }

  return {
    email: cleaned,
    name: "JabbuStore",
  };
}

export function resolveFromEmail(from: string): string | null {
  const identity = parseFromIdentity(from);
  if (!identity) return null;
  return `${identity.name} <${identity.email}>`;
}

export function parseRecipients(rawTo: string): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const part of rawTo.split(/[\r\n,;]+/)) {
    const email = extractEmailAddress(part);
    if (!email) continue;
    const normalized = email.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    recipients.push(email);
  }

  return recipients;
}

function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}

function resolveTitle(notification: NotificationLike): string {
  return NOTIFICATION_TITLES[notification.title] || notification.title;
}

function resolveContent(notification: NotificationLike): string {
  try {
    const parsed = JSON.parse(notification.content);
    if (parsed && typeof parsed === "object" && typeof parsed.key === "string") {
      const template = NOTIFICATION_CONTENTS[parsed.key];
      if (template) {
        return interpolate(template, (parsed.params as Record<string, unknown>) || {});
      }
    }
  } catch {
    // content is plain text
  }
  return notification.content;
}

function resolveFrontendBaseUrl(): string {
  const raw = config.frontendUrl || "";
  const firstUrl = raw
    .split(",")
    .map((entry) => entry.trim())
    .find(Boolean);
  return (firstUrl || "").replace(/\/+$/, "");
}

export function buildNotificationUrl(link: string | null): string | null {
  if (!link) return null;
  const trimmed = link.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const baseUrl = resolveFrontendBaseUrl();
  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const localizedPath = /^\/(es|en|br)(\/|$|\?)/.test(normalizedPath)
    ? normalizedPath
    : `/es${normalizedPath}`;

  return baseUrl ? `${baseUrl}${localizedPath}` : localizedPath;
}

function buildEmailText(notification: NotificationLike): string {
  const lines = [resolveTitle(notification), "", resolveContent(notification)];
  const url = buildNotificationUrl(notification.link);

  if (url) {
    lines.push("", `Enlace: ${url}`);
  }

  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml(notification: NotificationLike): string {
  const title = escapeHtml(resolveTitle(notification));
  const content = escapeHtml(resolveContent(notification)).replace(/\n/g, "<br />");
  const url = buildNotificationUrl(notification.link);
  const linkBlock = url
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#d946ef;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">Abrir en JabbuStore</a></p><p style="margin:12px 0 0;font-size:12px;color:#64748b;word-break:break-all;">${escapeHtml(url)}</p>`
    : "";

  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#0f0d1e;color:#f8fafc;border-radius:12px;border:1px solid #2e1065;">',
    `<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#e879f9;">JabbuStore</p>`,
    `<h2 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">${title}</h2>`,
    `<p style="margin:0;font-size:15px;line-height:1.6;color:#e2e8f0;">${content}</p>`,
    linkBlock,
    "</div>",
  ].join("");
}

interface ParsedSendGridError {
  statusCode: number | null;
  message: string;
  retryAfterMs: number | null;
}

function parseRetryAfterMs(headers: Record<string, unknown> | undefined): number | null {
  if (!headers) return null;

  const retryAfter = headers["retry-after"];
  if (typeof retryAfter === "string" || typeof retryAfter === "number") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
  }

  const rateLimitReset = headers["x-ratelimit-reset"];
  if (typeof rateLimitReset === "string" || typeof rateLimitReset === "number") {
    const resetEpochSec = Number(rateLimitReset);
    if (Number.isFinite(resetEpochSec) && resetEpochSec > 0) {
      const waitMs = resetEpochSec * 1000 - Date.now();
      if (waitMs > 0) {
        return Math.min(waitMs, MAX_RETRY_DELAY_MS);
      }
    }
  }

  return null;
}

function extractSendGridError(error: unknown): ParsedSendGridError {
  const errObj = error as {
    code?: unknown;
    message?: unknown;
    response?: {
      statusCode?: unknown;
      headers?: Record<string, unknown>;
      body?: unknown;
    };
  };

  const statusCode =
    typeof errObj?.code === "number"
      ? errObj.code
      : typeof errObj?.response?.statusCode === "number"
        ? errObj.response.statusCode
        : null;

  const retryAfterMs = parseRetryAfterMs(errObj?.response?.headers);
  const body = errObj?.response?.body;

  if (body && typeof body === "object" && "errors" in body && Array.isArray((body as { errors?: unknown }).errors)) {
    const parts = (body as { errors: Array<{ message?: unknown; field?: unknown }> }).errors
      .map((item) => {
        const msg = typeof item?.message === "string" ? item.message.trim() : "";
        const field = typeof item?.field === "string" && item.field.trim() ? ` (${item.field.trim()})` : "";
        return msg ? `${msg}${field}` : "";
      })
      .filter(Boolean);

    if (parts.length > 0) {
      return { statusCode, message: parts.join(" | "), retryAfterMs };
    }
  }

  if (typeof body === "string" && body.trim()) {
    return { statusCode, message: body.trim(), retryAfterMs };
  }

  const fallbackMessage =
    error instanceof Error && error.message
      ? error.message
      : typeof errObj?.message === "string" && errObj.message
        ? errObj.message
        : "Error devuelto por SendGrid.";

  return { statusCode, message: fallbackMessage, retryAfterMs };
}

function isRetryableSendGridStatus(statusCode: number | null): boolean {
  if (statusCode === null) return true;
  return statusCode === 429 || statusCode >= 500;
}

function scheduleSerialized<T>(task: () => Promise<T>): Promise<T> {
  const next = sendQueue.then(async () => {
    const elapsed = Date.now() - lastSendStartedAt;
    if (lastSendStartedAt > 0 && elapsed < MIN_SEND_INTERVAL_MS) {
      await sleep(MIN_SEND_INTERVAL_MS - elapsed);
    }
    lastSendStartedAt = Date.now();
    return task();
  });

  sendQueue = next.catch(() => undefined);
  return next;
}

async function createSendGridClient(apiKey: string): Promise<MailService> {
  const sgMailModule = await import("@sendgrid/mail");
  const MailServiceCtor =
    (sgMailModule as unknown as { MailService?: new () => MailService }).MailService ??
    (sgMailModule.default as unknown as { MailService?: new () => MailService })?.MailService;

  const client = MailServiceCtor ? new MailServiceCtor() : sgMailModule.default;
  client.setApiKey(apiKey);
  client.setTimeout?.(REQUEST_TIMEOUT_MS);
  return client;
}

async function readSecretSafe(
  key: "SENDGRID_API_KEY" | "SENDGRID_FROM" | "SENDGRID_TO",
): Promise<{ value: string; error?: string | undefined }> {
  try {
    const value = stripWrappingQuotes(await AdminSecureConfigService.getSecretValue(key));
    return { value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[SendGridService] Error leyendo ${key}:`, err);
    return { value: "", error: message };
  }
}

export class SendGridService {
  /**
   * Sends a notification email through Twilio SendGrid v3 Mail Send API.
   * Respects AdminSecureConfigService priority (.env first, DB fallback).
   */
  static async sendNotificationEmail(
    notification: NotificationLike,
  ): Promise<SendNotificationEmailResult> {
    try {
      const [apiKeySecret, fromSecret, toSecret] = await Promise.all([
        readSecretSafe("SENDGRID_API_KEY"),
        readSecretSafe("SENDGRID_FROM"),
        readSecretSafe("SENDGRID_TO"),
      ]);

      const apiKey = apiKeySecret.value;
      const rawFrom = fromSecret.value;
      const rawTo = toSecret.value;

      console.log("[SendGridService] Configuración leída:", {
        apiKeyConfigured: Boolean(apiKey),
        apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
        fromConfigured: Boolean(rawFrom),
        from: rawFrom || null,
        toConfigured: Boolean(rawTo),
        to: rawTo || null,
      });

      if (!apiKey) {
        const message = apiKeySecret.error
          ? `Error leyendo SENDGRID_API_KEY: ${apiKeySecret.error}`
          : "SENDGRID_API_KEY no está configurado.";
        console.warn(`[SendGridService] ${message} Email omitido.`);
        return { ok: false, skipped: true, error: message };
      }

      if (!rawFrom) {
        const message = fromSecret.error
          ? `Error leyendo SENDGRID_FROM: ${fromSecret.error}`
          : "SENDGRID_FROM no está configurado.";
        console.warn(`[SendGridService] ${message} Email omitido.`);
        return { ok: false, skipped: true, error: message };
      }

      const fromIdentity = parseFromIdentity(rawFrom);
      if (!fromIdentity) {
        const message = `SENDGRID_FROM tiene un formato de email inválido: "${rawFrom}".`;
        console.warn(`[SendGridService] ${message} Email omitido.`);
        return { ok: false, skipped: true, error: message };
      }
      const formattedFrom = `${fromIdentity.name} <${fromIdentity.email}>`;

      if (!rawTo) {
        const message = toSecret.error
          ? `Error leyendo SENDGRID_TO: ${toSecret.error}`
          : "SENDGRID_TO no está configurado.";
        console.warn(`[SendGridService] ${message} Email omitido.`);
        return { ok: false, skipped: true, error: message };
      }

      const recipients = parseRecipients(rawTo);
      if (recipients.length === 0) {
        const message = `SENDGRID_TO no contiene ningún email válido: "${rawTo}".`;
        console.warn(`[SendGridService] ${message} Email omitido.`);
        return { ok: false, skipped: true, error: message };
      }

      const subject = `JabbuStore - ${resolveTitle(notification)}`;
      const text = buildEmailText(notification);
      const html = buildEmailHtml(notification);
      const isMultiple = recipients.length > 1;
      const msg: MailDataRequired = {
        to: isMultiple ? recipients : recipients[0]!,
        from: fromIdentity,
        subject,
        text,
        html,
      };

      return await scheduleSerialized(async () => {
        const client = await createSendGridClient(apiKey);

        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
          try {
            const [response] = await client.send(msg, isMultiple);
            const rawHeaderId = response?.headers?.["x-message-id"];
            const messageId = typeof rawHeaderId === "string" ? rawHeaderId : undefined;

            console.log("[SendGridService] Email enviado:", {
              statusCode: response?.statusCode ?? 202,
              id: messageId ?? null,
              from: formattedFrom,
              to: recipients,
            });

            return {
              ok: true,
              id: messageId,
              from: formattedFrom,
              to: recipients,
              statusCode: response?.statusCode ?? 202,
            };
          } catch (attemptError) {
            const parsedError = extractSendGridError(attemptError);
            const retryable = isRetryableSendGridStatus(parsedError.statusCode);

            if (attempt < MAX_RETRY_ATTEMPTS && retryable) {
              const delayMs = parsedError.retryAfterMs ?? 1000 * attempt;
              console.warn(
                `[SendGridService] Error transitorio de SendGrid (status=${parsedError.statusCode ?? "network"}, intento ${attempt}/${MAX_RETRY_ATTEMPTS}): ${parsedError.message}`,
              );
              await sleep(delayMs);
              continue;
            }

            console.error("[SendGridService] SendGrid devolvió error:", {
              statusCode: parsedError.statusCode,
              message: parsedError.message,
            });
            return {
              ok: false,
              from: formattedFrom,
              to: recipients,
              error: parsedError.message,
              statusCode: parsedError.statusCode,
            };
          }
        }

        return {
          ok: false,
          from: formattedFrom,
          to: recipients,
          error: "No se pudo completar el envío de email tras múltiples reintentos.",
        };
      });
    } catch (error) {
      const parsedError = extractSendGridError(error);
      console.error("[SendGridService] Error enviando email de notificación:", parsedError.message);
      return {
        ok: false,
        error: parsedError.message,
        statusCode: parsedError.statusCode,
      };
    }
  }

  /**
   * Dispatches a verification email to validate the current SendGrid setup.
   */
  static async sendTestEmail(): Promise<SendNotificationEmailResult> {
    return this.sendNotificationEmail({
      title: "Prueba de Notificaciones por Email",
      content:
        "Si recibiste este mensaje, la configuración de SendGrid en JabbuStore está funcionando correctamente.",
      type: "SYSTEM",
      link: "/admin/panel/settings",
    });
  }
}
