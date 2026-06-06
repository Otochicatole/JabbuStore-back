import { Request, Response } from "express";
import {
  CreatePurchaseOrderUseCase,
  CreateSellOrderUseCase,
  GetUserOrdersUseCase,
  GetAllOrdersUseCase,
  UpdateOrderStatusUseCase,
} from "../application/OrderUseCases";
import { OrderStatus } from "../domain/Order";

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
      const { itemIds, items, metadata } = req.body;

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
        return res
          .status(400)
          .json({
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

  async validateOrder(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { type, itemIds, items } = req.body; // type is 'BUY' or 'SELL'

      if (type === "BUY") {
        if (!Array.isArray(itemIds) || itemIds.length === 0) {
          return res
            .status(400)
            .json({
              error:
                "itemIds must be a non-empty array of strings for BUY type",
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
          return res
            .status(400)
            .json({
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
          return res
            .status(400)
            .json({
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
          return res
            .status(400)
            .json({
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
            return res
              .status(400)
              .json({
                error: `El precio mínimo de venta es $${minSellPrice}. El item ${item.assetId} tiene precio $${item.requestedPrice}.`,
              });
          }

          const inventoryItem = await prisma.userInventoryItem.findFirst({
            where: { userId, assetId: item.assetId },
          });

          if (!inventoryItem) {
            return res
              .status(400)
              .json({
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
              return res
                .status(400)
                .json({
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
        return res
          .status(400)
          .json({
            error: "Invalid checkout validation type. Must be BUY or SELL",
          });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
