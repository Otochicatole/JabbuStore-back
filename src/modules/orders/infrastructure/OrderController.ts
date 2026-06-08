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

      res.status(201).json(order);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async createSellOrder(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { items, metadata } = req.body; // [{ assetId, requestedPrice }]

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error:
            "items must be a non-empty array of { assetId, requestedPrice }",
        });
      }

      const order = await this.createSellOrderUseCase.execute(
        userId,
        items,
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
      res.json(orders);
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
            const manifest = `id:${data?.id || req.query.id};request-timestamp:${ts};`;
            const hmac = crypto.createHmac("sha256", webhookSecret);
            const calculatedSignature = hmac.update(manifest).digest("hex");

            if (calculatedSignature !== v1) {
              console.warn(
                "[Mercado Pago Webhook] Firma de firma inválida. Posible intento de fraude.",
              );
              return res.status(401).send("Invalid signature");
            }
            console.log(
              "[Mercado Pago Webhook] Firma verificada y autenticada cryptográficamente.",
            );
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

      // Validar si es una notificación de pago
      if (
        type === "payment" ||
        action === "payment.created" ||
        action === "payment.updated" ||
        req.query.topic === "payment"
      ) {
        const paymentId = data?.id || req.query.id;
        if (!paymentId) return;

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
                  mpPaymentId: String(paymentId), // Guardar ID de pago oficial criptográfico de Mercado Pago
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

        // Separar ids: bots (assetId normal) vs market listings (prefijo "market-")
        const botIds = itemIds.filter(
          (id: string) => !id.startsWith("market-"),
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

        let totalPrice = 0;

        const resolvedBotItems = storeItems.map((item: any) => {
          totalPrice += item.price;
          return {
            assetId: item.assetId,
            name: item.name,
            price: item.price,
            iconUrl: item.iconUrl || null,
            provider: "bot",
          };
        });

        const resolvedMarketItems = marketItems.map((item: any) => {
          totalPrice += item.price;
          return {
            assetId: `market-${item.name}`,
            name: item.name,
            price: item.price,
            iconUrl: item.iconUrl || null,
            provider: item.provider, // 'buff' | 'youpin'
          };
        });

        totalPrice = Math.round(totalPrice * 100) / 100;

        return res.json({
          valid: true,
          type: "BUY",
          items: [...resolvedBotItems, ...resolvedMarketItems],
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
