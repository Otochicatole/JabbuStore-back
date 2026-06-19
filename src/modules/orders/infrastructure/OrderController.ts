import { Request, Response } from "express";
import fs from "fs";
import {
  CreatePurchaseOrderUseCase,
  CreateSellOrderUseCase,
  GetUserOrdersUseCase,
  GetAllOrdersUseCase,
  UpdateOrderStatusUseCase,
  findOpenSellOrderForAsset,
} from "../application/OrderUseCases";
import { OrderStatus, OrderType } from "../domain/Order";
import { MercadoPagoService } from "../../../shared/infrastructure/MercadoPagoService";
import { config } from "../../../shared/config";
import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { enrichOrderItemsWithYoupinLinks } from "./youpinLink";
import { BotService } from "../../marketplace/application/BotService";
import {
  getAdminSettingsOrDefaults,
  getBotCheckoutPrice,
  getMarketCheckoutPrice,
  getUserSellCheckoutPrice,
  roundMoney,
} from "../application/OrderPricingService";
import {
  PaymentProofMetadata,
  resolvePaymentProofPath,
  savePaymentProof,
} from "./PaymentProofStorage";

const SELL_PRICE_MISMATCH_TOLERANCE = 0.01;
const PAYMENT_AMOUNT_TOLERANCE = 0.01;

type OrderMetadataWithProofs = Record<string, any> & {
  buyerPaymentProof?: PaymentProofMetadata;
  adminPaymentProof?: PaymentProofMetadata;
};

interface ConfirmPaymentOptions {
  orderId: string;
  provider: "paypal" | "mercadopago" | "nowpayments";
  metadataKey: "paypalPaymentId" | "mpPaymentId" | "nowpaymentsPaymentId";
  paymentId: string;
  paidAmount?: number | null;
  currency?: string | null;
  expectedCurrency?: string;
}

export class OrderController {
  constructor(
    private createPurchaseOrderUseCase: CreatePurchaseOrderUseCase,
    private createSellOrderUseCase: CreateSellOrderUseCase,
    private getUserOrdersUseCase: GetUserOrdersUseCase,
    private getAllOrdersUseCase: GetAllOrdersUseCase,
    private updateOrderStatusUseCase: UpdateOrderStatusUseCase,
  ) {}

  private async transitionOrderToTradePendingFromPayment({
    orderId,
    provider,
    metadataKey,
    paymentId,
    paidAmount,
    currency,
    expectedCurrency = "USD",
  }: ConfirmPaymentOptions): Promise<{ updated: boolean; reason?: string }> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      console.warn(`[Payment Confirm] Orden ${orderId} no encontrada para ${provider}.`);
      return { updated: false, reason: "order_not_found" };
    }

    if (order.status !== "PENDING_PAYMENT") {
      console.warn(
        `[Payment Confirm] Orden ${orderId} está en ${order.status}; no se confirma de nuevo.`,
      );
      return { updated: false, reason: "invalid_status" };
    }

    if (currency && currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
      console.warn(
        `[Payment Confirm] Orden ${orderId} rechazada por moneda ${currency}; esperado ${expectedCurrency}.`,
      );
      return { updated: false, reason: "currency_mismatch" };
    }

    if (
      typeof paidAmount === "number" &&
      Number.isFinite(paidAmount) &&
      Math.abs(paidAmount - order.totalPrice) > PAYMENT_AMOUNT_TOLERANCE
    ) {
      console.warn(
        `[Payment Confirm] Orden ${orderId} rechazada por monto ${paidAmount}; esperado ${order.totalPrice}.`,
      );
      return { updated: false, reason: "amount_mismatch" };
    }

    const currentMetadata =
      order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata)
        ? (order.metadata as Record<string, any>)
        : {};

    const existingPaymentId = currentMetadata[metadataKey];
    if (existingPaymentId && String(existingPaymentId) !== String(paymentId)) {
      console.warn(
        `[Payment Confirm] Orden ${orderId} ya tiene ${metadataKey}=${existingPaymentId}; se rechazó ${paymentId}.`,
      );
      return { updated: false, reason: "payment_id_mismatch" };
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "TRADE_PENDING",
        metadata: {
          ...currentMetadata,
          [metadataKey]: String(paymentId),
          paymentProvider: provider,
          paidAt: new Date().toISOString(),
        },
      },
    });

    return { updated: true };
  }

  async createPurchaseOrder(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { itemIds, items, paymentMethod, metadata } = req.body;

      if (!Array.isArray(itemIds)) {
        return res
          .status(400)
          .json({ error: "itemIds must be an array of string" });
      }

      const settings = await getAdminSettingsOrDefaults();
      if (paymentMethod === "mercado_pago" && !settings.mercadoPagoEnabled) {
        return res.status(400).json({ error: "Mercado Pago no está habilitado." });
      }
      if (paymentMethod === "paypal" && !settings.paypalEnabled) {
        return res.status(400).json({ error: "PayPal no está habilitado." });
      }
      if (paymentMethod === "nowpayments" && !settings.nowpaymentsEnabled) {
        return res.status(400).json({ error: "NOWPayments no está habilitado." });
      }
      if (paymentMethod === "manual_transfer" && !settings.manualTransferEnabled) {
        return res.status(400).json({ error: "La transferencia manual no está habilitada." });
      }

      const order = await this.createPurchaseOrderUseCase.execute(
        userId,
        itemIds,
        paymentMethod,
        metadata,
        items,
      );

      // Si el método seleccionado es Mercado Pago, generar la preferencia y devolver el link de redirección
      if (paymentMethod === "mercado_pago") {
        try {
          const paymentUrl = await MercadoPagoService.createPreference(
            order,
            config.frontendUrl,
            config.backendUrl,
          );
          return res.status(201).json({
            ...order,
            paymentUrl, // Link de Checkout Pro seguro para redirigir
          });
        } catch (mpError: any) {
          console.error(
            "[Mercado Pago] Error al generar preferencia:",
            mpError,
          );
          // Retornar la orden pero indicar que falló generar Mercado Pago
          return res.status(201).json({
            ...order,
            error:
              "No se pudo generar el enlace de pago de Mercado Pago. Intente nuevamente en su perfil.",
          });
        }
      }

      // Si el método seleccionado es NOWPayments, generar el invoice y devolver el link de redirección
      if (paymentMethod === "nowpayments") {
        try {
          const { NOWPaymentsService } = require("../../../shared/infrastructure/NOWPaymentsService");
          const paymentUrl = await NOWPaymentsService.createInvoice(
            order,
            config.frontendUrl,
            config.backendUrl,
          );
          return res.status(201).json({
            ...order,
            paymentUrl, // Link de NOWPayments seguro para redirigir
          });
        } catch (nowError: any) {
          console.error(
            "[NOWPayments] Error al generar invoice:",
            nowError,
          );
          // Retornar la orden pero indicar que falló generar NOWPayments
          return res.status(201).json({
            ...order,
            error:
              "No se pudo generar el enlace de pago de NOWPayments. Intente nuevamente en su perfil.",
          });
        }
      }

      // Si el método seleccionado es PayPal, generar el link de aprobación
      if (paymentMethod === "paypal") {
        try {
          const { PayPalService } = require("../../../shared/infrastructure/PayPalService");
          const paymentUrl = await PayPalService.createOrder(
            order,
            config.frontendUrl,
            config.backendUrl,
          );
          return res.status(201).json({
            ...order,
            paymentUrl, // Link de aprobación de PayPal para redirigir
          });
        } catch (paypalError: any) {
          console.error(
            "[PayPal] Error al generar orden de pago:",
            paypalError,
          );
          // Retornar la orden pero indicar que falló generar PayPal
          return res.status(201).json({
            ...order,
            error:
              "No se pudo generar el enlace de pago de PayPal. Intente nuevamente en su perfil.",
          });
        }
      }

      res.status(201).json(order);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async createSellOrder(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { items, paymentMethod, metadata } = req.body; // [{ assetId, requestedPrice }]

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error:
            "items must be a non-empty array of { assetId, requestedPrice }",
        });
      }

      const order = await this.createSellOrderUseCase.execute(
        userId,
        items,
        paymentMethod,
        metadata,
      );
      res.status(201).json(order);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async cancelPaymentOrder(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;

      if (!id) {
        return res.status(400).json({ error: "Order id is required" });
      }

      const order = await prisma.order.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ error: "No autorizado para cancelar esta orden" });
      }

      if (order.type !== OrderType.BUY) {
        return res.status(400).json({ error: "Solo se pueden cancelar órdenes de compra desde el retorno de pago" });
      }

      if (order.status === OrderStatus.CANCELLED) {
        return res.json({ cancelled: true, order });
      }

      if (order.status !== OrderStatus.PENDING_PAYMENT) {
        return res.json({
          cancelled: false,
          reason: "order_not_pending",
          order,
        });
      }

      const updatedOrder = await this.updateOrderStatusUseCase.execute(
        id,
        OrderStatus.CANCELLED,
      );

      return res.json({ cancelled: true, order: updatedOrder });
    } catch (error: any) {
      console.error("[Cancel Payment Order] Error:", error);
      return res.status(500).json({ error: error.message || "Error al cancelar la orden" });
    }
  }

  async uploadBuyerPaymentProof(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;

      if (!id) {
        return res.status(400).json({ error: "Order id is required" });
      }

      const order = await prisma.order.findUnique({ where: { id } });
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ error: "No autorizado para subir comprobante a esta orden" });
      }

      if (order.type !== OrderType.BUY) {
        return res.status(400).json({ error: "El comprobante del comprador solo aplica a órdenes de compra" });
      }

      if (
        ![
          OrderStatus.PENDING_PAYMENT,
          OrderStatus.PAID,
          OrderStatus.TRADE_PENDING,
          OrderStatus.COMPLETED,
        ].includes(order.status as OrderStatus)
      ) {
        return res.status(400).json({ error: "Esta orden ya no permite cargar comprobante de pago" });
      }

      const proof = await savePaymentProof(id, "buyer", req.file);
      const metadata = (order.metadata && typeof order.metadata === "object"
        ? order.metadata
        : {}) as OrderMetadataWithProofs;

      const updatedOrder = await prisma.order.update({
        where: { id },
        data: {
          metadata: {
            ...metadata,
            buyerPaymentProof: proof,
          } as any,
        },
        include: { items: true },
      });

      return res.status(201).json({
        proof: {
          ...proof,
          storageKey: undefined,
        },
        order: updatedOrder,
      });
    } catch (error: any) {
      console.error("[Buyer Payment Proof] Error:", error);
      return res.status(400).json({ error: error.message || "No se pudo subir el comprobante" });
    }
  }

  async uploadAdminPaymentProof(req: Request, res: Response) {
    try {
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;

      if (!id) {
        return res.status(400).json({ error: "Order id is required" });
      }

      const order = await prisma.order.findUnique({ where: { id } });
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.type !== OrderType.SELL) {
        return res.status(400).json({ error: "El comprobante del admin solo aplica a órdenes de venta" });
      }

      if (![OrderStatus.PAID, OrderStatus.COMPLETED].includes(order.status as OrderStatus)) {
        return res.status(400).json({ error: "Subí el comprobante cuando el pago al usuario esté enviado o completado" });
      }

      const proof = await savePaymentProof(id, "admin", req.file);
      const metadata = (order.metadata && typeof order.metadata === "object"
        ? order.metadata
        : {}) as OrderMetadataWithProofs;

      const updatedOrder = await prisma.order.update({
        where: { id },
        data: {
          metadata: {
            ...metadata,
            adminPaymentProof: proof,
          } as any,
        },
        include: { items: true },
      });

      return res.status(201).json({
        proof: {
          ...proof,
          storageKey: undefined,
        },
        order: updatedOrder,
      });
    } catch (error: any) {
      console.error("[Admin Payment Proof] Error:", error);
      return res.status(400).json({ error: error.message || "No se pudo subir el comprobante" });
    }
  }

  async getPaymentProof(req: Request, res: Response) {
    try {
      const requester = (req as any).user;
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
      const rawProofType = req.params.proofType;
      const proofType = Array.isArray(rawProofType) ? rawProofType[0] : rawProofType;

      if (!id || (proofType !== "buyer" && proofType !== "admin")) {
        return res.status(400).json({ error: "Parámetros de comprobante inválidos" });
      }

      const order = await prisma.order.findUnique({ where: { id } });
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      const isAdmin = requester?.role === "ADMIN" || requester?.role === "SUPER_ADMIN";
      const isOwner = order.userId === requester?.id;
      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: "No autorizado para ver este comprobante" });
      }

      const metadata = (order.metadata && typeof order.metadata === "object"
        ? order.metadata
        : {}) as OrderMetadataWithProofs;
      const proof = proofType === "buyer"
        ? metadata.buyerPaymentProof
        : metadata.adminPaymentProof;

      if (!proof) {
        return res.status(404).json({ error: "Comprobante no encontrado" });
      }

      const proofPath = resolvePaymentProofPath(proof);
      await fs.promises.access(proofPath, fs.constants.R_OK);

      res.setHeader("Content-Type", proof.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(proof.fileName)}"`,
      );
      res.setHeader("X-Content-Type-Options", "nosniff");

      return fs.createReadStream(proofPath).pipe(res);
    } catch (error: any) {
      console.error("[Get Payment Proof] Error:", error);
      return res.status(404).json({ error: error.message || "No se pudo abrir el comprobante" });
    }
  }

  async getMyOrders(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const orders = await this.getUserOrdersUseCase.execute(userId);
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // Admin only
  async getAllOrders(req: Request, res: Response) {
    try {
      const orders = await this.getAllOrdersUseCase.execute();
      const enrichedOrders = await Promise.all(
        orders.map(async (order: any) => ({
          ...order,
          items: await enrichOrderItemsWithYoupinLinks(order.items),
        })),
      );

      res.json(enrichedOrders);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // Admin only
  async updateStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!Object.values(OrderStatus).includes(status)) {
        return res.status(400).json({ error: "Invalid order status" });
      }

      const existingOrder = await prisma.order.findUnique({
        where: { id: id as string },
        select: { id: true },
      });

      if (!existingOrder) {
        return res.status(404).json({ error: "Order not found" });
      }

      const order = await this.updateOrderStatusUseCase.execute(
        id as string,
        status as OrderStatus,
      );
      res.json(order);
    } catch (error: any) {
      console.error("[Orders] Error updating order status:", error);
      res.status(500).json({ error: error.message || "Error updating order status" });
    }
  }

  async handleNOWPaymentsWebhook(req: Request, res: Response) {
    try {
      const signature = req.headers["x-nowpayments-sig"] as string;
      const rawBody = JSON.stringify(req.body); // O usar el raw-body real de express si es necesario

      console.log(
        `[NOWPayments Webhook] Recibida notificación. Payment ID: ${req.body?.payment_id || req.body?.invoice_id}, Status: ${req.body?.payment_status}`,
      );

      const { NOWPaymentsService } = require("../../../shared/infrastructure/NOWPaymentsService");
      if (!NOWPaymentsService.verifySignature(rawBody, signature)) {
        console.warn(
          "[NOWPayments Webhook] Firma IPN inválida. Posible intento de fraude.",
        );
        return res.status(401).send("Invalid signature");
      }

      console.log(
        "[NOWPayments Webhook] Firma verificada y autenticada cryptográficamente.",
      );

      // Confirmar recepción de inmediato a NOWPayments
      res.status(200).send("OK");

      const { payment_status, order_id, payment_id } = req.body;

      // NOWPayments estados aprobados/completados: "finished" o "confirmed" (según la API de NOWPayments)
      if ((payment_status === "finished" || payment_status === "confirmed") && order_id) {
        console.log(
          `[NOWPayments Webhook] ¡Pago aprobado! Transicionando Orden ID: ${order_id} a TRADE_PENDING y guardando ID de Operación.`,
        );
        try {
          const result = await this.transitionOrderToTradePendingFromPayment({
            orderId: String(order_id),
            provider: "nowpayments",
            metadataKey: "nowpaymentsPaymentId",
            paymentId: String(payment_id),
          });

          if (result.updated) {
            console.log(
              `[NOWPayments Webhook] Orden ID ${order_id} transicionada y acreditada con éxito en DB.`,
            );
          }
        } catch (orderError: any) {
          console.error(
            `[NOWPayments Webhook] Error al actualizar la orden en DB:`,
            orderError.message,
          );
        }
      }
    } catch (err: any) {
      console.error(
        "[NOWPayments Webhook Error] Error procesando notificación:",
        err.message,
      );
      if (!res.headersSent) {
        res.status(500).send(err.message);
      }
    }
  }

  async handlePayPalWebhook(req: Request, res: Response) {
    try {
      const { token } = req.body; // PayPal Order Token enviado tras la redirección exitosa o webhook
      let paypalOrderId = token || req.query.token;

      console.log(
        `[PayPal Webhook/Callback] Recibida petición. EventType: ${req.body?.event_type}, BodyKeys: ${Object.keys(req.body || {})}, Query: ${JSON.stringify(req.query)}`
      );

      // Si es un evento de webhook indicando que la captura ya completó
      if (req.body && req.body.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        const captureId = req.body.resource?.id;
        const paypalOrderToken = req.body.resource?.supplementary_data?.related_ids?.order_id;
        console.warn(
          `[PayPal Webhook] Evento PAYMENT.CAPTURE.COMPLETED recibido sin verificación oficial. No se cambia estado. Capture ID: ${captureId}, Order Token: ${paypalOrderToken}`,
        );
        return res.json({
          success: true,
          message:
            "Evento recibido. La confirmación de órdenes PayPal se realiza por captura server-side verificada.",
        });
      }

      // Si no hay token directo pero es un webhook de PayPal, extraer el ID del recurso
      if (!paypalOrderId && req.body) {
        // En eventos como CHECKOUT.ORDER.APPROVED, el ID de la orden de PayPal está en resource.id
        if (req.body.resource?.id) {
          paypalOrderId = req.body.resource.id;
        }
      }

      if (!paypalOrderId) {
        return res.status(400).json({ error: "Falta el token de orden de PayPal (orderId)" });
      }

      console.log(
        `[PayPal Webhook/Callback] Procesando PayPal Order ID: ${paypalOrderId}`,
      );

      // Intentar deducir el ID de la orden de nuestra BD antes de capturar
      // Esto sirve si el webhook se dispara múltiples veces o después de la captura del frontend
      const dbOrderIdFromPayload = req.body.resource?.purchase_units?.[0]?.reference_id;
      if (dbOrderIdFromPayload) {
        const order = await prisma.order.findUnique({
          where: { id: dbOrderIdFromPayload },
        });
        if (order && (order.status === "TRADE_PENDING" || order.status === "PAID")) {
          console.log(
            `[PayPal Webhook] La orden ${dbOrderIdFromPayload} ya está transicionada a ${order.status}. Retornando éxito sin re-capturar.`
          );
          return res.json({ success: true, orderId: dbOrderIdFromPayload });
        }
      }

      const { PayPalService } = require("../../../shared/infrastructure/PayPalService");
      
      // Capturar de forma segura el pago en PayPal del lado del servidor para acreditarlo de forma inviolable
      let captureResult;
      try {
        captureResult = await PayPalService.capturePayment(String(paypalOrderId));
      } catch (captureErr: any) {
        console.warn(`[PayPal Webhook Warning] Falló capturePayment: ${captureErr.message}`);
        
        // Si falló la captura porque la orden ya fue capturada previamente,
        // buscamos si la orden en base de datos ya está en TRADE_PENDING o PAID.
        if (
          captureErr.message?.includes("ORDER_ALREADY_CAPTURED") ||
          captureErr.message?.includes("already been captured")
        ) {
          const orderIdToFind = dbOrderIdFromPayload;
          if (orderIdToFind) {
            const order = await prisma.order.findUnique({
              where: { id: orderIdToFind },
            });
            if (order && (order.status === "TRADE_PENDING" || order.status === "PAID")) {
              console.log(`[PayPal Webhook] Confirmado: Orden ${orderIdToFind} ya capturada previamente. Retornando éxito.`);
              return res.json({ success: true, orderId: orderIdToFind });
            }
          }
        }
        
        // Si el recurso no existe en PayPal (por ejemplo, IDs simulados en el panel de PayPal o expirados),
        // respondemos 200 OK para evitar que PayPal reintente infinitamente.
        if (
          captureErr.message?.includes("The specified resource does not exist") ||
          captureErr.message?.includes("RESOURCE_NOT_FOUND")
        ) {
          console.warn(`[PayPal Webhook Warning] Recurso no encontrado en PayPal. Evitando reintento del webhook.`);
          return res.status(200).json({
            success: false,
            error: "El recurso especificado no existe en PayPal (posible evento simulado o expirado)."
          });
        }
        
        throw captureErr;
      }

      const status = captureResult.status;
      const orderId = captureResult.purchase_units?.[0]?.reference_id; // Contiene nuestro ORDER_ID asociado de forma inviolable

      console.log(
        `[PayPal Callback] Captura procesada. Status: ${status}, Order ID asociado: ${orderId}`,
      );

      if (status === "COMPLETED" && orderId) {
        console.log(
          `[PayPal Webhook] ¡Pago completado! Transicionando Orden ID: ${orderId} a TRADE_PENDING y registrando ID de captura.`,
        );
        try {
          const captureId = captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.id || paypalOrderId;
          const captureAmount = captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
          const result = await this.transitionOrderToTradePendingFromPayment({
            orderId: String(orderId),
            provider: "paypal",
            metadataKey: "paypalPaymentId",
            paymentId: String(captureId),
            paidAmount: captureAmount?.value ? Number(captureAmount.value) : null,
            currency: captureAmount?.currency_code ?? null,
          });

          if (!result.updated) {
            return res.status(400).json({
              error: `El pago de PayPal fue capturado, pero la orden no se actualizó: ${result.reason}`,
            });
          }

          console.log(
            `[PayPal Webhook] Orden ID ${orderId} transicionada y acreditada con éxito en DB.`,
          );
          return res.json({ success: true, orderId });
        } catch (orderError: any) {
          console.error(
            `[PayPal Webhook] Error al actualizar la orden en DB:`,
            orderError.message,
          );
          return res.status(500).json({ error: "Error al registrar la orden en base de datos." });
        }
      }

      return res.status(400).json({ error: "El pago de PayPal no pudo ser completado o no se asoció a una orden válida." });
    } catch (err: any) {
      console.error(
        "[PayPal Webhook Error] Error capturando pago en PayPal:",
        err.message,
      );
      return res.status(500).json({ error: err.message });
    }
  }

  async handleMercadoPagoWebhook(req: Request, res: Response) {
    try {
      const { type, action, data } = req.body;
      console.log(
        `[Mercado Pago Webhook] Recibida notificación. Type: ${type}, Action: ${action}, ID:`,
        data?.id,
      );

      // FIRMA DE WEBHOOK DE MERCADO PAGO (Fórmula oficial HMAC-SHA256 con Webhook Secret)
      const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
      const xSignature = req.headers["x-signature"] as string;
      const xRequestId = req.headers["x-request-id"] as string;

      if (webhookSecret) {
        if (!xSignature || !xRequestId) {
          console.warn(
            "[Mercado Pago Webhook] Firma requerida ausente. Se rechaza la notificación.",
          );
          return res.status(401).json({ error: "Missing Mercado Pago webhook signature" });
        }

        try {
          const crypto = require("crypto");
          const parts = xSignature.split(",").map((part) => part.trim());
          const tsPart = parts.find((p) => p.startsWith("ts="));
          const v1Part = parts.find((p) => p.startsWith("v1="));

          if (!tsPart || !v1Part) {
            console.warn(
              "[Mercado Pago Webhook] Header de firma inválido. Se rechaza la notificación.",
            );
            return res.status(401).json({ error: "Invalid Mercado Pago webhook signature header" });
          }

          const ts = tsPart.split("=")[1];
          const v1 = v1Part.split("=")[1];
          const paymentId =
            req.query["data.id"] ||
            req.query.id ||
            data?.id ||
            req.body?.data?.id ||
            req.body?.id;

          if (!paymentId || !ts || !v1) {
            console.warn(
              "[Mercado Pago Webhook] Datos insuficientes para verificar firma. Se rechaza la notificación.",
            );
            return res.status(401).json({ error: "Missing Mercado Pago webhook signature data" });
          }

          // Fórmula oficial: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
          const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts};`;
          const hmac = crypto.createHmac("sha256", webhookSecret);
          const calculatedSignature = hmac.update(manifest).digest("hex");

          if (calculatedSignature !== v1) {
            console.warn(
              `[Mercado Pago Webhook] Firma inválida. Se rechaza la notificación. Payment ID: ${paymentId}`,
            );
            return res.status(401).json({ error: "Invalid Mercado Pago webhook signature" });
          }

          console.log(
            "[Mercado Pago Webhook] Firma verificada y autenticada cryptográficamente.",
          );
        } catch (sigErr: any) {
          console.error(
            "[Mercado Pago Webhook] Error al verificar firma:",
            sigErr.message,
          );
          return res.status(401).json({ error: "Mercado Pago webhook signature verification failed" });
        }
      } else {
        console.warn(
          "[Mercado Pago Webhook] MERCADOPAGO_WEBHOOK_SECRET no está configurado. No se puede verificar la firma.",
        );
      }

      // Responder de inmediato con 200 OK para confirmar recepción a Mercado Pago
      res.status(200).send("OK");

      // Validar si es una notificación de pago o acción sobre recursos (petición POST de webhook de MP)
      // MP envía notificaciones con type 'payment' o action 'payment.created' / 'payment.updated'
      const paymentId = data?.id || req.body?.data?.id || req.query.id || req.body?.id;
      const isPaymentTopic = type === "payment" || action === "payment.created" || action === "payment.updated" || req.query.topic === "payment" || req.body?.type === "payment";

      if (paymentId && isPaymentTopic) {
        // Consultar los detalles reales del pago a Mercado Pago (previene Spoofing / Hacks de respuestas falsas)
        const paymentDetails = await MercadoPagoService.getPaymentDetails(
          String(paymentId),
        );

        const status = paymentDetails.status;
        const orderId = paymentDetails.external_reference; // Contiene nuestro ORDER_ID de forma inviolable
        const amount = paymentDetails.transaction_amount;

        console.log(
          `[Mercado Pago Webhook] Pago ID ${paymentId} resuelto. Status: ${status}, OrderID: ${orderId}, Monto: ${amount}`,
        );

        if (status === "approved" && orderId) {
          // El pago está aprobado. Avanzar la orden al estado TRADE_PENDING de forma automatizada y registrar el MP Payment ID
          console.log(
            `[Mercado Pago Webhook] ¡Pago aprobado! Transicionando Orden ID: ${orderId} a TRADE_PENDING y guardando ID de Operación.`,
          );
          try {
            const result = await this.transitionOrderToTradePendingFromPayment({
              orderId: String(orderId),
              provider: "mercadopago",
              metadataKey: "mpPaymentId",
              paymentId: String(paymentId),
              paidAmount: typeof amount === "number" ? amount : Number(amount),
              currency: paymentDetails.currency_id ?? null,
              expectedCurrency: "ARS",
            });

            if (result.updated) {
              console.log(
                `[Mercado Pago Webhook] Orden ID ${orderId} transicionada y acreditada con éxito en DB.`,
              );
            }
          } catch (orderError: any) {
            console.error(
              `[Mercado Pago Webhook] Error al actualizar la orden en DB:`,
              orderError.message,
            );
          }
        }
      }
    } catch (err: any) {
      console.error(
        "[Mercado Pago Webhook Error] Error procesando notificación:",
        err.message,
      );
      // No devolvemos error HTTP ya que ya respondimos 200 OK arriba de forma asíncrona
    }
  }

  async validateOrder(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { type, itemIds, items } = req.body; // type is 'BUY' or 'SELL'

      if (type === "BUY") {
        if (!Array.isArray(itemIds) || itemIds.length === 0) {
          return res.status(400).json({
            error: "itemIds must be a non-empty array of strings for BUY type",
          });
        }

        const {
          prisma,
        } = require("../../../shared/infrastructure/PrismaClient");

        // Separar ids: bots | assets YouPin (youpin-) | listings legacy (market-)
        const youpinFloatIds = itemIds
          .filter((id: string) => id.startsWith("youpin-"))
          .map((id: string) => id.replace(/^youpin-/, ""));
        const botIds = itemIds.filter(
          (id: string) =>
            !id.startsWith("market-") && !id.startsWith("youpin-"),
        );
        const marketNames = itemIds
          .filter((id: string) => id.startsWith("market-"))
          .map((id: string) => id.replace(/^market-/, ""));

        // Validar bot items
        const storeItems =
          botIds.length > 0
            ? await prisma.storeItem.findMany({
                where: { assetId: { in: botIds } },
              })
            : [];

        if (storeItems.length !== botIds.length) {
          const foundIds = storeItems.map((i: any) => i.assetId);
          const missingIds = botIds.filter(
            (id: string) => !foundIds.includes(id),
          );
          return res.status(400).json({
            error: `Algunos items de bot ya no están disponibles: ${missingIds.join(", ")}`,
          });
        }

        try {
          await BotService.assertStoreItemsFromActiveBots(storeItems);
        } catch (err: any) {
          return res.status(400).json({ error: err.message });
        }

        // Validar market listings usando su campo unique 'name'
        const marketItems =
          marketNames.length > 0
            ? await prisma.marketListing.findMany({
                where: { name: { in: marketNames } },
              })
            : [];

        if (marketItems.length !== marketNames.length) {
          const foundNames = marketItems.map((i: any) => i.name);
          const missingNames = marketNames.filter(
            (name: string) => !foundNames.includes(name),
          );
          return res.status(400).json({
            error: `Algunos listings de mercado ya no están disponibles: ${missingNames.join(", ")}`,
          });
        }

        const youpinFloatItems =
          youpinFloatIds.length > 0
            ? await prisma.floatItem.findMany({
                where: { id: { in: youpinFloatIds }, available: true },
                include: { resaleItem: true },
              })
            : [];

        if (youpinFloatItems.length !== youpinFloatIds.length) {
          const foundIds = youpinFloatItems.map((f: any) => f.id);
          const missingIds = youpinFloatIds.filter(
            (id: string) => !foundIds.includes(id),
          );
          return res.status(400).json({
            error: `Algunos assets YouPin ya no están disponibles: ${missingIds.join(", ")}`,
          });
        }

        const overridesMap = new Map<string, any>();
        if (Array.isArray(items)) {
          items.forEach((ov) => {
            if (ov && ov.assetId) overridesMap.set(ov.assetId, ov);
          });
        }

        const settingsData = await getAdminSettingsOrDefaults();

        const resolvedBotItems = storeItems.map((item: any) => {
          const override = overridesMap.get(item.assetId);
          return {
            assetId: item.assetId,
            name: item.name,
            price: getBotCheckoutPrice(item.price, settingsData),
            iconUrl: item.iconUrl || null,
            provider: "bot",
            float: override?.float !== undefined && override?.float !== null ? override.float : item.float,
            pattern: override?.pattern !== undefined && override?.pattern !== null ? override.pattern : item.pattern,
            exterior: item.exterior ?? null,
            rarity: item.rarity ?? null,
          };
        });

        const resolvedMarketItems = await Promise.all(
          marketItems.map(async (item: any) => {
            const override = overridesMap.get(`market-${item.name}`);
            if (override && override.float !== undefined && override.float !== null) {
              const floatQueryWhere: any = {
                resaleItemId: item.id,
                floatValue: Number(override.float),
              };
              if (override.pattern !== undefined && override.pattern !== null) {
                floatQueryWhere.paintSeed = Number(override.pattern);
              }
              const dbFloat = await prisma.floatItem.findFirst({
                where: floatQueryWhere,
              });

              if (dbFloat) {
                const floatPrice = getMarketCheckoutPrice(dbFloat.price, settingsData);

                return {
                  assetId: `market-${item.name}`,
                  name: item.name,
                  price: floatPrice,
                  iconUrl: item.iconUrl || null,
                  provider: 'youpin',
                  float: dbFloat.floatValue,
                  pattern: dbFloat.paintSeed,
                  exterior: item.exterior ?? null,
                  rarity: item.rarity ?? null,
                };
              }
            }

            return {
              assetId: `market-${item.name}`,
              name: item.name,
              price: getMarketCheckoutPrice(item.price, settingsData),
              iconUrl: item.iconUrl || null,
              provider: 'youpin',
              float: null,
              pattern: null,
              exterior: item.exterior ?? null,
              rarity: item.rarity ?? null,
            };
          })
        );

        const resolvedYoupinItems = youpinFloatItems.map((dbFloat: any) => {
          const floatPrice = getMarketCheckoutPrice(dbFloat.price, settingsData);

          const listing = dbFloat.resaleItem;
          return {
            assetId: `youpin-${dbFloat.id}`,
            name: listing.name,
            price: floatPrice,
            iconUrl: listing.iconUrl || null,
            provider: 'youpin',
            float: dbFloat.floatValue,
            pattern: dbFloat.paintSeed,
            exterior: listing.exterior ?? null,
            rarity: listing.rarity ?? null,
          };
        });

        let totalPrice = 0;
        resolvedBotItems.forEach((item) => totalPrice += item.price);
        resolvedMarketItems.forEach((item) => totalPrice += item.price);
        resolvedYoupinItems.forEach((item) => totalPrice += item.price);
        totalPrice = roundMoney(totalPrice);

        return res.json({
          valid: true,
          type: "BUY",
          items: [...resolvedBotItems, ...resolvedMarketItems, ...resolvedYoupinItems],
          totalPrice,
        });
      } else if (type === "SELL") {
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({
            error:
              "items must be a non-empty array of { assetId, requestedPrice } for SELL type",
          });
        }

        const {
          prisma,
        } = require("../../../shared/infrastructure/PrismaClient");
        const settings = await getAdminSettingsOrDefaults();
        const minSellPrice = settings.minimumUserSellPrice;

        const resolvedItems: any[] = [];
        let totalPrice = 0;

        for (const item of items) {
          const inventoryItem = await prisma.userInventoryItem.findFirst({
            where: { userId, assetId: item.assetId },
          });

          if (!inventoryItem) {
            return res.status(400).json({
              error: `El item ${item.assetId} no se encuentra en tu inventario.`,
            });
          }

          const backendPrice = getUserSellCheckoutPrice(inventoryItem.price, settings);
          const requestedPrice = Number(item.requestedPrice);

          if (backendPrice < minSellPrice) {
            return res.status(400).json({
              error: `El precio mínimo de venta es $${minSellPrice}. El item ${item.assetId} tiene precio $${backendPrice}.`,
            });
          }

          if (
            Number.isFinite(requestedPrice) &&
            Math.abs(requestedPrice - backendPrice) > SELL_PRICE_MISMATCH_TOLERANCE
          ) {
            return res.status(400).json({
              error: `El precio del item "${inventoryItem.name}" cambió a $${backendPrice}. Refrescá tu inventario e intentá nuevamente.`,
            });
          }

          const openSellOrder = await findOpenSellOrderForAsset(userId, item.assetId);
          if (openSellOrder) {
            return res.status(400).json({
              error: `El item "${inventoryItem.name}" ya tiene una solicitud de venta en curso.`,
            });
          }

          const alreadyListed = await prisma.skinListing.findFirst({
            where: {
              skinId: item.assetId,
              status: { in: ["active", "reserved"] },
            },
          });

          if (alreadyListed) {
            // Self-healing check: If the listing is active but the only corresponding sell order is CANCELLED,
            // we should self-heal the listing to 'cancelled' and allow this validation to pass!
            const lastSellOrder = await prisma.order.findFirst({
              where: {
                userId,
                type: "SELL",
                items: {
                  some: { assetId: item.assetId },
                },
              },
              orderBy: { createdAt: "desc" },
            });

            if (lastSellOrder && lastSellOrder.status === "CANCELLED") {
              // Update the listing to cancelled
              await prisma.skinListing.update({
                where: { id: alreadyListed.id },
                data: { status: "cancelled" },
              });
              console.log(
                `[Self-Healing] Updated orphan skin listing ${alreadyListed.id} to cancelled because its last sell order was CANCELLED.`,
              );
            } else {
              return res.status(400).json({
                error: `El item "${inventoryItem.name}" ya está listado para la venta.`,
              });
            }
          }

          resolvedItems.push({
            assetId: inventoryItem.assetId,
            name: inventoryItem.name,
            price: backendPrice,
            iconUrl: inventoryItem.iconUrl ?? null,
            provider: "user",
            float: inventoryItem.float,
            pattern: inventoryItem.pattern,
            exterior: inventoryItem.exterior,
            rarity: inventoryItem.rarity,
          });

          totalPrice += backendPrice;
        }

        totalPrice = roundMoney(totalPrice);

        return res.json({
          valid: true,
          type: "SELL",
          items: resolvedItems,
          totalPrice,
        });
      } else {
        return res.status(400).json({
          error: "Invalid checkout validation type. Must be BUY or SELL",
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
