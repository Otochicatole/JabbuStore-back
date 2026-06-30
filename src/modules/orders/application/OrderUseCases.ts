import {
  IOrderRepository,
  Order,
  OrderItem,
  OrderStatus,
  OrderType,
} from "../domain/Order";
import { INotificationRepository } from "../../notifications/domain/Notification";
import { CreateOrUpdateNotificationUseCase } from "../../notifications/application/NotificationUseCases";
import { PrismaNotificationRepository } from "../../notifications/infrastructure/PrismaNotificationRepository";
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

    // Map overrides for fast lookup
    const overridesMap = new Map<string, any>();
    if (Array.isArray(itemsOverrides)) {
      itemsOverrides.forEach((ov) => {
        if (ov && ov.assetId) overridesMap.set(ov.assetId, ov);
      });
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

    const specificBotIds = botIds.filter(id => overridesMap.get(id)?.isSpecific !== false);
    const missingSpecificBotIds = specificBotIds.filter(id => !storeItems.some(i => i.assetId === id));
    if (missingSpecificBotIds.length > 0) {
      throw new Error(
        `Some bot items are no longer available: ${missingSpecificBotIds.join(", ")}`,
      );
    }

    const storeItemsToAssert = storeItems.filter(item => specificBotIds.includes(item.assetId));
    if (storeItemsToAssert.length > 0) {
      await BotService.assertStoreItemsFromActiveBots(storeItemsToAssert);
    }

    // Resolver market listings usando su campo unique 'name'
    const marketListings =
      marketNames.length > 0
        ? await prisma.marketListing.findMany({
            where: { name: { in: marketNames } },
          })
        : [];

    const specificMarketNames = marketNames.filter(name => overridesMap.get(`market-${name}`)?.isSpecific !== false);
    const missingSpecificMarketNames = specificMarketNames.filter(name => !marketListings.some(i => i.name === name));
    if (missingSpecificMarketNames.length > 0) {
      throw new Error(
        `Some market listings are no longer available: ${missingSpecificMarketNames.join(", ")}`,
      );
    }

    const youpinFloatItems =
      youpinFloatIds.length > 0
        ? await prisma.floatItem.findMany({
            where: { id: { in: youpinFloatIds }, available: true },
            include: { resaleItem: true },
          })
        : [];

    const specificYoupinFloatIds = youpinFloatIds.filter(id => overridesMap.get(`youpin-${id}`)?.isSpecific !== false);
    const missingSpecificYoupinFloatIds = specificYoupinFloatIds.filter(id => !youpinFloatItems.some(f => f.id === id));
    if (missingSpecificYoupinFloatIds.length > 0) {
      throw new Error(
        `Some YouPin assets are no longer available: ${missingSpecificYoupinFloatIds.join(", ")}`,
      );
    }

    let totalPrice = 0;
    const orderItemsData: Omit<OrderItem, "id" | "orderId">[] = [];

    const settingsData = await getAdminSettingsOrDefaults();

    // Bot items — precio real de DB + modificador global, float/pattern reales
    for (const botId of botIds) {
      const item = storeItems.find((i) => i.assetId === botId);
      const override = overridesMap.get(botId);
      
      let itemPrice: number;
      if (item) {
        itemPrice = getBotCheckoutPrice(item.price, settingsData);
      } else {
        itemPrice = override?.price ? roundMoney(override.price) : 0;
      }
      
      totalPrice += itemPrice;
      orderItemsData.push({
        assetId: botId,
        name: item?.name || override?.name || "CS2 Skin",
        price: itemPrice,
        iconUrl: item?.iconUrl || override?.iconUrl || null,
        rarity: override?.rarity || item?.rarity || "common",
        exterior: override?.exterior || item?.exterior || null,
        float:
          override?.float !== undefined && override?.float !== null
            ? override.float
            : (item?.float || null),
        pattern:
          override?.pattern !== undefined && override?.pattern !== null
            ? override.pattern
            : (item?.pattern || null),
        provider: "bot",
      });
    }

    // Market listings — precio del catálogo u override de float individual
    for (const name of marketNames) {
      const item = marketListings.find((i: any) => i.name === name);
      const override = overridesMap.get(`market-${name}`);
      let itemPrice: number;
      let itemFloat: number | null = null;
      let itemPattern: number | null = null;
      let itemProvider = item?.provider || "youpin";

      if (item) {
        itemPrice = getMarketCheckoutPrice(item.price, settingsData);
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
            itemPrice = getMarketCheckoutPrice(dbFloat.price, settingsData);
            itemFloat = dbFloat.floatValue;
            itemPattern = dbFloat.paintSeed;
            itemProvider = dbFloat.market.toLowerCase();
          }
        }
      } else {
        itemPrice = override?.price ? roundMoney(override.price) : 0;
        itemFloat = override?.float !== undefined && override?.float !== null ? override.float : null;
        itemPattern = override?.pattern !== undefined && override?.pattern !== null ? override.pattern : null;
      }

      totalPrice += itemPrice;
      orderItemsData.push({
        assetId: `market-${name}`,
        name: name,
        price: itemPrice,
        iconUrl: item?.iconUrl || override?.iconUrl || null,
        rarity: item?.rarity || override?.rarity || "common",
        exterior: item?.exterior || override?.exterior || null,
        float: itemFloat,
        pattern: itemPattern,
        provider: itemProvider,
      });
    }

    for (const floatId of youpinFloatIds) {
      const dbFloat = youpinFloatItems.find((f) => f.id === floatId);
      const override = overridesMap.get(`youpin-${floatId}`);
      
      let itemPrice: number;
      let name: string;
      let iconUrl: string | null = null;
      let rarity: string = "common";
      let exterior: string | null = null;
      let floatVal: number | null = null;
      let patternVal: number | null = null;
      
      if (dbFloat) {
        itemPrice = getMarketCheckoutPrice(dbFloat.price, settingsData);
        const listing = dbFloat.resaleItem;
        name = listing.name;
        iconUrl = listing.iconUrl;
        rarity = listing.rarity;
        exterior = listing.exterior;
        floatVal = dbFloat.floatValue;
        patternVal = dbFloat.paintSeed;
      } else {
        itemPrice = override?.price ? roundMoney(override.price) : 0;
        name = override?.name || "CS2 Skin";
        iconUrl = override?.iconUrl || null;
        rarity = override?.rarity || "common";
        exterior = override?.exterior || null;
        floatVal = override?.float !== undefined && override?.float !== null ? override.float : null;
        patternVal = override?.pattern !== undefined && override?.pattern !== null ? override.pattern : null;
      }
      
      totalPrice += itemPrice;
      orderItemsData.push({
        assetId: `youpin-${floatId}`,
        name,
        price: itemPrice,
        iconUrl,
        rarity,
        exterior,
        float: floatVal,
        pattern: patternVal,
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

    // Send persistent notification to admin
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const notificationRepository = new PrismaNotificationRepository();
      const notificationUseCase = new CreateOrUpdateNotificationUseCase(notificationRepository);
      await notificationUseCase.execute({
        title: "Nueva Orden de Compra",
        content: `El usuario ${user?.name || "Steam User"} ha realizado una compra por $${totalPrice.toLocaleString()} USD.`,
        type: "ORDER_STATUS",
        link: "/admin/panel/dashboard?tab=purchases",
        userId: null,
        adminId: null,
      });
    } catch (err) {
      console.error("[CreatePurchaseOrderUseCase] Error sending admin notification:", err);
    }

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
    quoteId?: string,
  ): Promise<Order> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.email?.trim() || !user.tradeUrl?.trim()) {
      throw new Error("Para realizar ventas debes tener registrado tu Email y Trade URL en tu perfil.");
    }

    let resolvedItems: Omit<OrderItem, "id" | "orderId">[] = [];
    let totalPrice = 0;

    if (quoteId) {
      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        include: { items: true },
      });
      if (!quote) throw new Error("Cotización no encontrada.");
      if (quote.userId !== userId) throw new Error("Acceso denegado a esta cotización.");
      if (quote.status !== "QUOTED") throw new Error("La cotización no está en estado respondida por el administrador.");

      resolvedItems = quote.items.map((item) => {
        if (item.price === null || item.price === undefined) {
          throw new Error(`El ítem ${item.name} no tiene precio cotizado.`);
        }
        return {
          assetId: item.assetId,
          name: item.name,
          price: item.price,
          iconUrl: item.iconUrl ?? null,
          rarity: item.rarity,
          exterior: item.exterior,
          float: item.float,
          pattern: item.pattern,
          provider: "user",
        };
      });
      totalPrice = roundMoney(resolvedItems.reduce((sum, item) => sum + item.price, 0));
    } else {
      if (!items || items.length === 0) {
        throw new Error("No items provided for the sell order");
      }
      const settings = await getAdminSettingsOrDefaults();
      const minSellPrice = settings.minimumUserSellPrice;

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
    }

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

    if (quoteId) {
      await prisma.quote.update({
        where: { id: quoteId },
        data: { status: "ACCEPTED" },
      });
    }

    // Fetch full order with items populated for the webhook dispatcher
    const fullOrder = await this.orderRepository.findById(order.id);
    if (fullOrder) {
      WebhookService.sendOrderNotification(fullOrder, "order.created");
    }

    // Send persistent notification to admin
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const notificationRepository = new PrismaNotificationRepository();
      const notificationUseCase = new CreateOrUpdateNotificationUseCase(notificationRepository);
      await notificationUseCase.execute({
        title: "Nueva Solicitud de Venta",
        content: `El usuario ${user?.name || "Steam User"} ha creado una nueva orden de venta por $${totalPrice.toLocaleString()} USD.`,
        type: "ORDER_STATUS",
        link: "/admin/panel/dashboard?tab=listings",
        userId: null,
        adminId: null,
      });
    } catch (err) {
      console.error("[CreateSellOrderUseCase] Error sending admin notification:", err);
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
  constructor(
    private orderRepository: IOrderRepository,
    private notificationRepository?: INotificationRepository
  ) {}

  async execute(orderId: string, status: OrderStatus): Promise<Order> {
    const order = await this.orderRepository.updateStatus(orderId, status);

    // Dispatch webhook status change notification
    WebhookService.sendOrderNotification(order, "order.status_updated");

    // Crear notificación persistente para el cliente
    if (this.notificationRepository) {
      try {
        const createNotificationUseCase = new CreateOrUpdateNotificationUseCase(this.notificationRepository);
        
        const isSell = order.type === OrderType.SELL;
        let title = 'Estado de orden actualizado';
        let content = `El estado de tu orden #${order.id.slice(0, 8)} cambió a ${status}.`;
        
        if (status === OrderStatus.PAID) {
          if (isSell) {
            title = 'Trade recibido';
            content = `Hemos recibido los ítems para tu orden de venta #${order.id.slice(0, 8)}. En breve se te enviará el dinero.`;
          } else {
            title = 'Orden pagada con éxito';
            content = `Hemos recibido tu pago para la orden #${order.id.slice(0, 8)}. ¡Gracias por tu compra!`;
          }
        } else if (status === OrderStatus.COMPLETED) {
          if (isSell) {
            title = 'Venta completada';
            content = `El pago para tu orden de venta #${order.id.slice(0, 8)} ha sido enviado con éxito.`;
          } else {
            title = 'Orden completada';
            content = `La orden #${order.id.slice(0, 8)} ha sido entregada y completada.`;
          }
        } else if (status === OrderStatus.CANCELLED) {
          if (isSell) {
            title = 'Venta cancelada';
            content = `Tu orden de venta #${order.id.slice(0, 8)} ha sido cancelada.`;
          } else {
            title = 'Orden cancelada';
            content = `La orden #${order.id.slice(0, 8)} ha sido cancelada.`;
          }
        } else if (status === OrderStatus.TRADE_PENDING) {
          if (isSell) {
            title = 'Venta aprobada (Enviar Trade)';
            content = `Tu orden de venta #${order.id.slice(0, 8)} ha sido aprobada. Por favor, envía tus ítems mediante el intercambio de Steam.`;
          } else {
            title = 'Intercambio de Steam pendiente';
            content = `La orden #${order.id.slice(0, 8)} está lista. Revisa tus ofertas de intercambio de Steam.`;
          }
        }

        await createNotificationUseCase.execute({
          userId: order.userId,
          adminId: null,
          title,
          content,
          type: 'ORDER_STATUS',
          link: '/purchases',
        });
      } catch (err) {
        console.error('[UpdateOrderStatusUseCase] Error creating database notification:', err);
      }
    }

    return order;
  }
}
