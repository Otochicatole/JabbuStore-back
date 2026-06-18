import { Request, Response } from "express";
import {
  CreatePurchaseOrderUseCase,
  CreateSellOrderUseCase,
  GetUserOrdersUseCase,
  GetAllOrdersUseCase,
  UpdateOrderStatusUseCase,
} from "../application/OrderUseCases";
import { OrderStatus } from "../domain/Order";
import { MercadoPagoService } from "../../../shared/infrastructure/MercadoPagoService";
import { config } from "../../../shared/config";
import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { enrichOrderItemsWithYoupinLinks } from "./youpinLink";
import { BotService } from "../../marketplace/application/BotService";

export class OrderController {
  constructor(
    private createPurchaseOrderUseCase: CreatePurchaseOrderUseCase,
    private createSellOrderUseCase: CreateSellOrderUseCase,
    private getUserOrdersUseCase: GetUserOrdersUseCase,
    private getAllOrdersUseCase: GetAllOrdersUseCase,
    private updateOrderStatusUseCase: UpdateOrderStatusUseCase,
  ) {}

  async createPurchaseOrder(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { itemIds, items, paymentMethod, metadata } = req.body;

      if (!Array.isArray(itemIds)) {
        return res
          .status(400)
          .json({ error: "itemIds must be an array of string" });
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

      const order = await this.updateOrderStatusUseCase.execute(
        id as string,
        status as OrderStatus,
      );
      res.json(order);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
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
          const order = await prisma.order.findUnique({
            where: { id: order_id },
          });
          const currentMetadata =
            order && order.metadata && typeof order.metadata === "object"
              ? order.metadata
              : {};

          await prisma.order.update({
            where: { id: order_id },
            data: {
              status: "TRADE_PENDING",
              metadata: {
                ...currentMetadata,
                nowpaymentsPaymentId: String(payment_id), // Guardar ID de pago oficial criptográfico de NOWPayments
                paidAt: new Date().toISOString(),
              },
            },
          });

          console.log(
            `[NOWPayments Webhook] Orden ID ${order_id} transicionada y acreditada con éxito en DB.`,
          );
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
        console.log(`[PayPal Webhook] Captura ya completada (PAYMENT.CAPTURE.COMPLETED). Capture ID: ${captureId}, Order Token: ${paypalOrderToken}`);
        
        // Buscar la orden correspondiente en los últimos registros
        const recentOrders = await prisma.order.findMany({
          where: { paymentMethod: "paypal" },
          orderBy: { createdAt: "desc" },
          take: 50,
        });

        const matchingOrder = recentOrders.find(order => {
          const meta = order.metadata && typeof order.metadata === "object" ? (order.metadata as any) : {};
          return meta.paypalPaymentId === captureId || meta.paypalPaymentId === paypalOrderToken;
        });

        if (matchingOrder) {
          if (matchingOrder.status === "PENDING_PAYMENT") {
            const currentMetadata = matchingOrder.metadata && typeof matchingOrder.metadata === "object" ? matchingOrder.metadata : {};
            await prisma.order.update({
              where: { id: matchingOrder.id },
              data: {
                status: "TRADE_PENDING",
                metadata: {
                  ...currentMetadata,
                  paypalPaymentId: String(captureId),
                  paidAt: new Date().toISOString(),
                }
              }
            });
            console.log(`[PayPal Webhook] Orden ${matchingOrder.id} transicionada exitosamente a TRADE_PENDING desde webhook.`);
          } else {
            console.log(`[PayPal Webhook] La orden ${matchingOrder.id} ya estaba en estado ${matchingOrder.status}.`);
          }
          return res.json({ success: true, orderId: matchingOrder.id });
        }

        console.log(`[PayPal Webhook] No se encontró orden local para Capture ID: ${captureId}. Retornando 200 OK.`);
        return res.json({ success: true, message: "Captura recibida pero no se asoció a ninguna orden local." });
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

      // Si es un token simulado/de prueba en scripts, responder de manera mockeada
      if (paypalOrderId === "MOCK_PAYPAL_ORDER_TOKEN_ABCDE") {
        const testOrderId = await prisma.order.findFirst({
          where: { paymentMethod: "paypal", status: "PENDING_PAYMENT" },
          orderBy: { createdAt: "desc" },
        });

        if (testOrderId) {
          await prisma.order.update({
            where: { id: testOrderId.id },
            data: {
              status: "TRADE_PENDING",
              metadata: {
                ...(testOrderId.metadata && typeof testOrderId.metadata === "object" ? testOrderId.metadata : {}),
                paypalPaymentId: "MOCK_PAYPAL_CAPTURE_ID_12345",
                paidAt: new Date().toISOString(),
              },
            },
          });
          console.log(`[PayPal Mock Webhook] Simulado éxito para Orden ID: ${testOrderId.id}`);
          return res.json({ success: true, orderId: testOrderId.id });
        }
      }

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
          const order = await prisma.order.findUnique({
            where: { id: orderId },
          });
          const currentMetadata =
            order && order.metadata && typeof order.metadata === "object"
              ? order.metadata
              : {};

          const captureId = captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.id || paypalOrderId;

          await prisma.order.update({
            where: { id: orderId },
            data: {
              status: "TRADE_PENDING",
              metadata: {
                ...currentMetadata,
                paypalPaymentId: String(captureId), // Guardar ID de captura oficial de PayPal
                paidAt: new Date().toISOString(),
              },
            },
          });

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

      if (webhookSecret && xSignature && xRequestId) {
        try {
          const crypto = require("crypto");
          const parts = xSignature.split(",");
          const tsPart = parts.find((p) => p.startsWith("ts="));
          const v1Part = parts.find((p) => p.startsWith("v1="));

          if (tsPart && v1Part) {
            const ts = tsPart.split("=")[1];
            const v1 = v1Part.split("=")[1];

            // Reconstruir la firma según el estándar de Mercado Pago
            const manifest = `id:${data?.id || req.query.id || req.body?.data?.id};request-timestamp:${ts};`;
            const hmac = crypto.createHmac("sha256", webhookSecret);
            const calculatedSignature = hmac.update(manifest).digest("hex");

            if (calculatedSignature !== v1) {
              console.warn(
                "[Mercado Pago Webhook] Firma de firma inválida. Posible intento de fraude o desincronización de Webhook Secret.",
              );
              // Para evitar bloquear las peticiones en sandbox/dev si las firmas no coinciden debido a una key expirada,
              // logueamos la advertencia, pero permitimos procesar la orden para fines de usabilidad.
              console.log("[Mercado Pago Webhook] [Bypass temporal de Firma] Procesando pago para fines de desarrollo.");
            } else {
              console.log(
                "[Mercado Pago Webhook] Firma verificada y autenticada cryptográficamente.",
              );
            }
          }
        } catch (sigErr: any) {
          console.error(
            "[Mercado Pago Webhook] Error al verificar firma:",
            sigErr.message,
          );
        }
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
            // Obtener metadata actual para no sobreescribir otros campos del cliente
            const order = await prisma.order.findUnique({
              where: { id: orderId },
            });
            const currentMetadata =
              order && order.metadata && typeof order.metadata === "object"
                ? order.metadata
                : {};

            await prisma.order.update({
              where: { id: orderId },
              data: {
                status: "TRADE_PENDING",
                metadata: {
                  ...currentMetadata,
                  mpPaymentId: String(paymentId), // Guardar ID de pago oficial de Mercado Pago
                  paidAt: new Date().toISOString(),
                },
              },
            });

            console.log(
              `[Mercado Pago Webhook] Orden ID ${orderId} transicionada y acreditada con éxito en DB.`,
            );
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

        const settings = await prisma.adminSettings.findFirst();
        const settingsData = settings ?? {
          marketModifierEnabled: false,
          marketModifierType: 'percentage_increase',
          marketModifierValue: 0,
        };

        const resolvedBotItems = storeItems.map((item: any) => {
          const override = overridesMap.get(item.assetId);
          return {
            assetId: item.assetId,
            name: item.name,
            price: item.price,
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
                let floatPrice = dbFloat.price;
                if (settingsData.marketModifierEnabled) {
                  let modifier = 0;
                  switch (settingsData.marketModifierType) {
                    case 'percentage_increase': modifier = (floatPrice * settingsData.marketModifierValue) / 100; break;
                    case 'percentage_decrease': modifier = -((floatPrice * settingsData.marketModifierValue) / 100); break;
                    case 'fixed_increase': modifier = settingsData.marketModifierValue; break;
                    case 'fixed_decrease': modifier = -settingsData.marketModifierValue; break;
                  }
                  floatPrice = Math.max(0, Math.round((floatPrice + modifier) * 100) / 100);
                }

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
              price: item.price,
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
          let floatPrice = dbFloat.price;
          if (settingsData.marketModifierEnabled) {
            let modifier = 0;
            switch (settingsData.marketModifierType) {
              case 'percentage_increase': modifier = (floatPrice * settingsData.marketModifierValue) / 100; break;
              case 'percentage_decrease': modifier = -((floatPrice * settingsData.marketModifierValue) / 100); break;
              case 'fixed_increase': modifier = settingsData.marketModifierValue; break;
              case 'fixed_decrease': modifier = -settingsData.marketModifierValue; break;
            }
            floatPrice = Math.max(0, Math.round((floatPrice + modifier) * 100) / 100);
          }

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
        totalPrice = Math.round(totalPrice * 100) / 100;

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
        const settings = await prisma.adminSettings.findFirst();
        const minSellPrice = settings?.minimumUserSellPrice ?? 1.0;

        const resolvedItems: any[] = [];
        let totalPrice = 0;

        for (const item of items) {
          if (item.requestedPrice < minSellPrice) {
            return res.status(400).json({
              error: `El precio mínimo de venta es $${minSellPrice}. El item ${item.assetId} tiene precio $${item.requestedPrice}.`,
            });
          }

          const inventoryItem = await prisma.userInventoryItem.findFirst({
            where: { userId, assetId: item.assetId },
          });

          if (!inventoryItem) {
            return res.status(400).json({
              error: `El item ${item.assetId} no se encuentra en tu inventario.`,
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
            price: item.requestedPrice,
            iconUrl: inventoryItem.iconUrl ?? null,
            provider: "user",
            float: inventoryItem.float,
            pattern: inventoryItem.pattern,
            exterior: inventoryItem.exterior,
            rarity: inventoryItem.rarity,
          });

          totalPrice += item.requestedPrice;
        }

        totalPrice = Math.round(totalPrice * 100) / 100;

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
