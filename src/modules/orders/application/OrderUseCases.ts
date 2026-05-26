import { IOrderRepository, Order, OrderItem, OrderStatus, OrderType } from '../domain/Order';
import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { WebhookService } from './WebhookService';

export class CreatePurchaseOrderUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(userId: string, assetIds: string[], metadata?: any, itemsOverrides?: any[]): Promise<Order> {
    if (!assetIds || assetIds.length === 0) {
      throw new Error('No items provided for the order');
    }

    // Obtenemos los items directamente de la base de datos para asegurar el precio real
    const storeItems = await prisma.storeItem.findMany({
      where: {
        assetId: { in: assetIds }
      }
    });

    if (storeItems.length !== assetIds.length) {
      const foundIds = storeItems.map(i => i.assetId);
      const missingIds = assetIds.filter(id => !foundIds.includes(id));
      throw new Error(`Some items are no longer available in the store: ${missingIds.join(', ')}`);
    }

    // Map overrides list for fast lookup
    const overridesMap = new Map<string, any>();
    if (Array.isArray(itemsOverrides)) {
      itemsOverrides.forEach(ov => {
        if (ov && ov.assetId) {
          overridesMap.set(ov.assetId, ov);
        }
      });
    }

    let totalPrice = 0;
    const orderItemsData: Omit<OrderItem, 'id' | 'orderId'>[] = storeItems.map(item => {
      totalPrice += item.price;
      const override = overridesMap.get(item.assetId);
      
      // Determine provider: use override, or database field, or fallback to bots
      let provider = "bots";
      if (override && override.provider) {
        provider = override.provider;
      } else if (item.botSteamId === "resell_market") {
        provider = "youpin"; // resell default
      }

      return {
        assetId: item.assetId,
        name: item.name,
        price: item.price,
        iconUrl: item.iconUrl,
        rarity: override?.rarity || item.rarity,
        exterior: override?.exterior || item.exterior,
        float: (override?.float !== undefined && override?.float !== null) ? override.float : item.float,
        pattern: (override?.pattern !== undefined && override?.pattern !== null) ? override.pattern : item.pattern,
        provider: provider
      };
    });

    // Fix floating point precision
    totalPrice = Math.round(totalPrice * 100) / 100;

    const orderData = {
      userId,
      type: OrderType.BUY,
      status: OrderStatus.PENDING_PAYMENT,
      totalPrice,
      metadata,
      items: [] // is passed separately
    };

    const order = await this.orderRepository.create(orderData, orderItemsData);
    
    // Dispatch webhook notification in the background
    WebhookService.sendOrderNotification(order, 'order.created');
    
    return order;
  }
}

// === SELL ORDER ===
export class CreateSellOrderUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(userId: string, items: { assetId: string; requestedPrice: number }[], metadata?: any): Promise<Order> {
    if (!items || items.length === 0) {
      throw new Error('No items provided for the sell order');
    }

    const settings = await prisma.adminSettings.findFirst();
    const minSellPrice = settings?.minimumUserSellPrice ?? 1.0;

    // Validate each item: must be in user's inventory and meet minimum price
    const resolvedItems: Omit<OrderItem, 'id' | 'orderId'>[] = [];
    let totalPrice = 0;

    for (const item of items) {
      if (item.requestedPrice < minSellPrice) {
        throw new Error(`El precio mínimo de venta es $${minSellPrice}. El item ${item.assetId} tiene precio $${item.requestedPrice}.`);
      }

      const inventoryItem = await prisma.userInventoryItem.findFirst({
        where: { userId, assetId: item.assetId }
      });

      if (!inventoryItem) {
        throw new Error(`Item ${item.assetId} no encontrado en tu inventario.`);
      }

      const alreadyListed = await prisma.skinListing.findFirst({
        where: { skinId: item.assetId, status: { in: ['active', 'reserved'] } }
      });

      if (alreadyListed) {
        // Self-healing check: If the listing is active but the only corresponding sell order is CANCELLED,
        // we should self-heal the listing to 'cancelled' and allow this creation to pass!
        const lastSellOrder = await prisma.order.findFirst({
          where: {
            userId,
            type: 'SELL',
            items: {
              some: { assetId: item.assetId }
            }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (lastSellOrder && lastSellOrder.status === 'CANCELLED') {
          // Update the listing to cancelled
          await prisma.skinListing.update({
            where: { id: alreadyListed.id },
            data: { status: 'cancelled' }
          });
          console.log(`[Self-Healing] Updated orphan skin listing ${alreadyListed.id} to cancelled because its last sell order was CANCELLED.`);
        } else {
          throw new Error(`El item "${inventoryItem.name}" ya está listado para la venta.`);
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
        provider: "user"
      });

      totalPrice += item.requestedPrice;
    }

    totalPrice = Math.round(totalPrice * 100) / 100;

    // Create Order + SkinListings atomically
    const order = await this.orderRepository.create(
      { userId, type: OrderType.SELL, status: OrderStatus.PENDING_PAYMENT, totalPrice, metadata, items: [] },
      resolvedItems
    );

    // Create a SkinListing for each item so it appears in the marketplace
    await prisma.skinListing.createMany({
      data: resolvedItems.map(item => ({
        userId,
        skinId: item.assetId,
        basePrice: item.price,
        finalPrice: item.price,
        status: 'active',
      }))
    });

    // Fetch full order with items populated for the webhook dispatcher
    const fullOrder = await this.orderRepository.findById(order.id);
    if (fullOrder) {
      WebhookService.sendOrderNotification(fullOrder, 'order.created');
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
    WebhookService.sendOrderNotification(order, 'order.status_updated');
    
    return order;
  }
}
