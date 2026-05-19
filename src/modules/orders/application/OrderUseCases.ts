import { IOrderRepository, Order, OrderItem, OrderStatus, OrderType } from '../domain/Order';
import { prisma } from '../../../shared/infrastructure/PrismaClient';

export class CreatePurchaseOrderUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(userId: string, assetIds: string[]): Promise<Order> {
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

    let totalPrice = 0;
    const orderItemsData: Omit<OrderItem, 'id' | 'orderId'>[] = storeItems.map(item => {
      totalPrice += item.price;
      return {
        assetId: item.assetId,
        name: item.name,
        price: item.price,
        iconUrl: item.iconUrl
      };
    });

    // Fix floating point precision
    totalPrice = Math.round(totalPrice * 100) / 100;

    const orderData = {
      userId,
      type: OrderType.BUY,
      status: OrderStatus.PENDING_PAYMENT,
      totalPrice,
      items: [] // is passed separately
    };

    const order = await this.orderRepository.create(orderData, orderItemsData);
    return order;
  }
}

// === SELL ORDER ===
export class CreateSellOrderUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(userId: string, items: { assetId: string; requestedPrice: number }[]): Promise<Order> {
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
        throw new Error(`El item "${inventoryItem.name}" ya está listado para la venta.`);
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

    // Create Order + SkinListings atomically
    const order = await this.orderRepository.create(
      { userId, type: OrderType.SELL, status: OrderStatus.PENDING_PAYMENT, totalPrice, items: [] },
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
    return this.orderRepository.updateStatus(orderId, status);
  }
}
