import {
  IOrderRepository,
  Order,
  OrderItem,
  OrderStatus,
  OrderType,
} from "../domain/Order";
import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { WebhookService } from "./WebhookService";
import { BotService } from "../../marketplace/application/BotService";
import {
  getAdminSettingsOrDefaults,
  getBotCheckoutPrice,
  getMarketCheckoutPrice,
  getUserSellCheckoutPrice,
  roundMoney,
} from "./OrderPricingService";

const PRICE_MISMATCH_TOLERANCE = 0.01;
const OPEN_SELL_ORDER_STATUSES = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.TRADE_PENDING,
  OrderStatus.PAID,
];

export async function findOpenSellOrderForAsset(userId: string, assetId: string) {
  return prisma.order.findFirst({
    where: {
      userId,
      type: "SELL",
      status: { in: OPEN_SELL_ORDER_STATUSES },
      items: {
        some: { assetId },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
}

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

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.email?.trim() || !user.tradeUrl?.trim()) {
      throw new Error("Para realizar compras debes tener registrado tu Email y Trade URL en tu perfil.");
    }

    // Separar bot items, assets YouPin individuales y listings legacy
    const youpinFloatIds = assetIds
      .filter((id) => id.startsWith("youpin-"))
      .map((id) => id.replace(/^youpin-/, ""));
    const botIds = assetIds.filter(
      (id) => !id.startsWith("market-") && !id.startsWith("youpin-"),
    );
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

    await BotService.assertStoreItemsFromActiveBots(storeItems);

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

    const youpinFloatItems =
      youpinFloatIds.length > 0
        ? await prisma.floatItem.findMany({
            where: { id: { in: youpinFloatIds }, available: true },
            include: { resaleItem: true },
          })
        : [];

    if (youpinFloatItems.length !== youpinFloatIds.length) {
      const foundIds = youpinFloatItems.map((f) => f.id);
      const missingIds = youpinFloatIds.filter((id) => !foundIds.includes(id));
      throw new Error(
        `Some YouPin assets are no longer available: ${missingIds.join(", ")}`,
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

    const settingsData = await getAdminSettingsOrDefaults();

    // Bot items — precio real de DB + modificador global, float/pattern reales
    for (const item of storeItems) {
      const itemPrice = getBotCheckoutPrice(item.price, settingsData);
      totalPrice += itemPrice;
      const override = overridesMap.get(item.assetId);
      orderItemsData.push({
        assetId: item.assetId,
        name: item.name,
        price: itemPrice,
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

    // Market listings — precio del catálogo u override de float individual
    for (const item of marketListings as any[]) {
      const override = overridesMap.get(`market-${item.name}`);
      let itemPrice = getMarketCheckoutPrice(item.price, settingsData);
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
          const floatPrice = getMarketCheckoutPrice(dbFloat.price, settingsData);

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

    for (const dbFloat of youpinFloatItems) {
      const floatPrice = getMarketCheckoutPrice(dbFloat.price, settingsData);

      const listing = dbFloat.resaleItem;
      totalPrice += floatPrice;
      orderItemsData.push({
        assetId: `youpin-${dbFloat.id}`,
        name: listing.name,
        price: floatPrice,
        iconUrl: listing.iconUrl,
        rarity: listing.rarity,
        exterior: listing.exterior,
        float: dbFloat.floatValue,
        pattern: dbFloat.paintSeed,
        provider: 'youpin',
      });
    }

    totalPrice = roundMoney(totalPrice);

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

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.email?.trim() || !user.tradeUrl?.trim()) {
      throw new Error("Para realizar ventas debes tener registrado tu Email y Trade URL en tu perfil.");
    }

    const settings = await getAdminSettingsOrDefaults();
    const minSellPrice = settings.minimumUserSellPrice;

    // Validate each item: must be in user's inventory and meet minimum price
    const resolvedItems: Omit<OrderItem, "id" | "orderId">[] = [];
    let totalPrice = 0;

    for (const item of items) {
      const inventoryItem = await prisma.userInventoryItem.findFirst({
        where: { userId, assetId: item.assetId },
      });

      if (!inventoryItem) {
        throw new Error(`Item ${item.assetId} no encontrado en tu inventario.`);
      }

      const backendPrice = getUserSellCheckoutPrice(inventoryItem.price, settings);
      const requestedPrice = Number(item.requestedPrice);

      if (backendPrice < minSellPrice) {
        throw new Error(
          `El precio mínimo de venta es $${minSellPrice}. El item ${item.assetId} tiene precio $${backendPrice}.`,
        );
      }

      if (
        Number.isFinite(requestedPrice) &&
        Math.abs(requestedPrice - backendPrice) > PRICE_MISMATCH_TOLERANCE
      ) {
        throw new Error(
          `El precio del item "${inventoryItem.name}" cambió a $${backendPrice}. Refrescá tu inventario e intentá nuevamente.`,
        );
      }

      const openSellOrder = await findOpenSellOrderForAsset(userId, item.assetId);
      if (openSellOrder) {
        throw new Error(
          `El item "${inventoryItem.name}" ya tiene una solicitud de venta en curso.`,
        );
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
        price: backendPrice,
        iconUrl: inventoryItem.iconUrl ?? null,
        rarity: inventoryItem.rarity,
        exterior: inventoryItem.exterior,
        float: inventoryItem.float,
        pattern: inventoryItem.pattern,
        provider: "user",
      });

      totalPrice += backendPrice;
    }

    totalPrice = roundMoney(totalPrice);

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
