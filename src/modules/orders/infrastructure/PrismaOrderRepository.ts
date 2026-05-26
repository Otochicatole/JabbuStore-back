import { IOrderRepository, Order, OrderItem, OrderStatus, OrderType } from '../domain/Order';
import { prisma } from '../../../shared/infrastructure/PrismaClient';

export class PrismaOrderRepository implements IOrderRepository {
  async create(orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>, itemsData: Omit<OrderItem, 'id' | 'orderId'>[]): Promise<Order> {
    const createdOrder = await prisma.order.create({
      data: {
        userId: orderData.userId,
        type: orderData.type as any,
        status: orderData.status as any,
        totalPrice: orderData.totalPrice,
        paymentMethod: orderData.paymentMethod || null,
        metadata: orderData.metadata || null,
        items: {
          create: itemsData.map(item => ({
            assetId: item.assetId,
            name: item.name,
            price: item.price,
            iconUrl: item.iconUrl || null,
            rarity: item.rarity || null,
            exterior: item.exterior || null,
            float: item.float !== undefined ? item.float : null,
            pattern: item.pattern !== undefined ? item.pattern : null,
            provider: item.provider || null,
          }))
        }
      },
      include: {
        items: true
      }
    });

    return createdOrder as any;
  }

  async findById(id: string): Promise<Order | null> {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true }
    });
    return order as any;
  }

  async findByUserId(userId: string): Promise<Order[]> {
    const orders = await prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });
    return orders as any;
  }

  async findAll(): Promise<Order[]> {
    const orders = await prisma.order.findMany({
      include: { 
        items: true,
        user: {
          select: { name: true, steamId: true, avatar: true, tradeUrl: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return orders as any;
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    const order = await prisma.order.update({
      where: { id },
      data: { status: status as any },
      include: { items: true }
    });

    // If a SELL order is cancelled, cancel any corresponding active or reserved skin listings as well
    if (status === 'CANCELLED' && order.type === 'SELL') {
      const assetIds = order.items.map(item => item.assetId);
      if (assetIds.length > 0) {
        await prisma.skinListing.updateMany({
          where: {
            skinId: { in: assetIds },
            userId: order.userId,
            status: { in: ['active', 'reserved'] }
          },
          data: { status: 'cancelled' }
        });
      }
    }

    return order as any;
  }
}
