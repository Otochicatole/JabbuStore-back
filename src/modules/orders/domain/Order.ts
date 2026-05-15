export enum OrderType {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum OrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  TRADE_PENDING = 'TRADE_PENDING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export interface OrderItem {
  id: string;
  orderId: string;
  assetId: string;
  name: string;
  price: number;
  iconUrl?: string | null;
}

export interface Order {
  id: string;
  userId: string;
  type: OrderType;
  status: OrderStatus;
  totalPrice: number;
  items: OrderItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrderRepository {
  create(order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>, items: Omit<OrderItem, 'id' | 'orderId'>[]): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  findByUserId(userId: string): Promise<Order[]>;
  findAll(): Promise<Order[]>;
  updateStatus(id: string, status: OrderStatus): Promise<Order>;
}
