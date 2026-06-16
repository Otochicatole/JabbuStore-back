import {
  IOrderRepository,
  Order,
  OrderItem,
  OrderStatus,
  OrderType,
} from "../domain/Order";
import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { WebhookService } from "./WebhookService";

export class CreatePurchaseOrderUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(
    userId: string,
    assetIds: string[],
    paymentMethod?: string,
    metadata?: any,
    itemsOverrides?: any[],
  ): Promise<Order> {
    if (!assetIds || assetIds.length === 0) {
      throw new Error("No items provided for the order");
    }

    // Separar bot items de market listings
    const botIds = assetIds.filter((id) => !id.startsWith("market-"));
    const marketNames = assetIds
      .filter((id) => id.startsWith("market-"))
      .map((id) => id.replace(/^market-/, ""));

    // Resolver bot items
    const storeItems =
      botIds.length > 0
        ? await prisma.storeItem.findMany({
            where: { assetId: { in: botIds } },
          })
        : [];

    if (storeItems.length !== botIds.length) {
      const foundIds = storeItems.map((i) => i.assetId);
      const missingIds = botIds.filter((id) => !foundIds.includes(id));
      throw new Error(
        `Some bot items are no longer available: ${missingIds.join(", ")}`,
      );
    }

    // Resolver market listings usando su campo unique 'name'
    const marketListings =
      marketNames.length > 0
        ? await prisma.marketListing.findMany({
            where: { name: { in: marketNames } },
          })
        : [];

    if (marketListings.length !== marketNames.length) {
      const foundNames = marketListings.map((i: any) => i.name);
      const missingNames = marketNames.filter(
        (name) => !foundNames.includes(name),
      );
      throw new Error(
        `Some market listings are no longer available: ${missingNames.join(", ")}`,
      );
    }

    // Map overrides for fast lookup
    const overridesMap = new Map<string, any>();
    if (Array.isArray(itemsOverrides)) {
      itemsOverrides.forEach((ov) => {
        if (ov && ov.assetId) overridesMap.set(ov.assetId, ov);
      });
    }

    let totalPrice = 0;
    const orderItemsData: Omit<OrderItem, "id" | "orderId">[] = [];

    // Bot items — precio real de DB, float/pattern reales
    for (const item of storeItems) {
      totalPrice += item.price;
      const override = overridesMap.get(item.assetId);
      orderItemsData.push({
        assetId: item.assetId,
        name: item.name,
        price: item.price,
        iconUrl: item.iconUrl,
        rarity: override?.rarity || item.rarity,
        exterior: override?.exterior || item.exterior,
        float:
          override?.float !== undefined && override?.float !== null
            ? override.float
            : item.float,
        pattern:
          override?.pattern !== undefined && override?.pattern !== null
            ? override.pattern
            : item.pattern,
        provider: "bot",
      });
    }

    const settings = await prisma.adminSettings.findFirst();
    const settingsData = settings ?? {
      marketModifierEnabled: false,
      marketModifierType: 'percentage_increase',
      marketModifierValue: 0,
    };

    // Market listings — precio del catálogo u override de float individual
    for (const item of marketListings as any[]) {
      const override = overridesMap.get(`market-${item.name}`);
      let itemPrice = item.price;
      let itemFloat: number | null = null;
      let itemPattern: number | null = null;
      let itemProvider = item.provider;

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

          itemPrice = floatPrice;
          itemFloat = dbFloat.floatValue;
          itemPattern = dbFloat.paintSeed;
          itemProvider = dbFloat.market.toLowerCase();
        }
      }

      totalPrice += itemPrice;
      orderItemsData.push({
        assetId: `market-${item.name}`,
        name: item.name,
        price: itemPrice,
        iconUrl: item.iconUrl,
        rarity: item.rarity,
        exterior: item.exterior,
        float: itemFloat,
        pattern: itemPattern,
        provider: itemProvider,
      });
    }

    totalPrice = Math.round(totalPrice * 100) / 100;

    const orderData = {
      userId,
      type: OrderType.BUY,
      status: OrderStatus.PENDING_PAYMENT,
      totalPrice,
      paymentMethod: paymentMethod || null,
      metadata,
      items: [],
    };

    const order = await this.orderRepository.create(orderData, orderItemsData);
    WebhookService.sendOrderNotification(order, "order.created");
    return order;
  }
}

// === SELL ORDER ===
export class CreateSellOrderUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(
    userId: string,
    items: { assetId: string; requestedPrice: number }[],
    paymentMethod?: string,
    metadata?: any,
  ): Promise<Order> {
    if (!items || items.length === 0) {
      throw new Error("No items provided for the sell order");
    }

    const settings = await prisma.adminSettings.findFirst();
    const minSellPrice = settings?.minimumUserSellPrice ?? 1.0;

    // Validate each item: must be in user's inventory and meet minimum price
    const resolvedItems: Omit<OrderItem, "id" | "orderId">[] = [];
    let totalPrice = 0;

    for (const item of items) {
      if (item.requestedPrice < minSellPrice) {
        throw new Error(
          `El precio mínimo de venta es $${minSellPrice}. El item ${item.assetId} tiene precio $${item.requestedPrice}.`,
        );
      }

      const inventoryItem = await prisma.userInventoryItem.findFirst({
        where: { userId, assetId: item.assetId },
      });

      if (!inventoryItem) {
        throw new Error(`Item ${item.assetId} no encontrado en tu inventario.`);
      }

      const alreadyListed = await prisma.skinListing.findFirst({
        where: { skinId: item.assetId, status: { in: ["active", "reserved"] } },
      });

      if (alreadyListed) {
        // Self-healing check: If the listing is active but the only corresponding sell order is CANCELLED,
        // we should self-heal the listing to 'cancelled' and allow this creation to pass!
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
          throw new Error(
            `El item "${inventoryItem.name}" ya está listado para la venta.`,
          );
        }
      }

      resolvedItems.push({
        assetId: inventoryItem.assetId,
        name: inventoryItem.name,
        price: item.requestedPrice,
        iconUrl: inventoryItem.iconUrl ?? null,
        rarity: inventoryItem.rarity,
        exterior: inventoryItem.exterior,
        float: inventoryItem.float,
        pattern: inventoryItem.pattern,
        provider: "user",
      });

      totalPrice += item.requestedPrice;
    }

    totalPrice = Math.round(totalPrice * 100) / 100;

    // Create Order + SkinListings atomically
    const order = await this.orderRepository.create(
      {
        userId,
        type: OrderType.SELL,
        status: OrderStatus.PENDING_PAYMENT,
        totalPrice,
        paymentMethod: paymentMethod || null,
        metadata,
        items: [],
      },
      resolvedItems,
    );

    // Create a SkinListing for each item so it appears in the marketplace
    await prisma.skinListing.createMany({
      data: resolvedItems.map((item) => ({
        userId,
        skinId: item.assetId,
        basePrice: item.price,
        finalPrice: item.price,
        status: "active",
      })),
    });

    // Fetch full order with items populated for the webhook dispatcher
    const fullOrder = await this.orderRepository.findById(order.id);
    if (fullOrder) {
      WebhookService.sendOrderNotification(fullOrder, "order.created");
    }

    return order;
  }
}

export class GetUserOrdersUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(userId: string): Promise<Order[]> {
    return this.orderRepository.findByUserId(userId);
  }
}

export class GetAllOrdersUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(): Promise<Order[]> {
    return this.orderRepository.findAll();
  }
}

export class UpdateOrderStatusUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(orderId: string, status: OrderStatus): Promise<Order> {
    const order = await this.orderRepository.updateStatus(orderId, status);

    // Dispatch webhook status change notification
    WebhookService.sendOrderNotification(order, "order.status_updated");

    return order;
  }
}
