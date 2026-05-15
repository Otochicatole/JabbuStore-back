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
