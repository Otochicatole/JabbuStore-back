import { Request, Response } from 'express';
import { 
  CreatePurchaseOrderUseCase, 
  GetUserOrdersUseCase, 
  GetAllOrdersUseCase, 
  UpdateOrderStatusUseCase 
} from '../application/OrderUseCases';
import { OrderStatus } from '../domain/Order';

export class OrderController {
  constructor(
    private createPurchaseOrderUseCase: CreatePurchaseOrderUseCase,
    private getUserOrdersUseCase: GetUserOrdersUseCase,
    private getAllOrdersUseCase: GetAllOrdersUseCase,
    private updateOrderStatusUseCase: UpdateOrderStatusUseCase
  ) {}

  async createPurchaseOrder(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { itemIds } = req.body;

      if (!Array.isArray(itemIds)) {
        return res.status(400).json({ error: 'itemIds must be an array of string' });
      }

      const order = await this.createPurchaseOrderUseCase.execute(userId, itemIds);
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
        return res.status(400).json({ error: 'Invalid order status' });
      }

      const order = await this.updateOrderStatusUseCase.execute(id as string, status as OrderStatus);
      res.json(order);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
