import { Router } from 'express';
import { OrderController } from './OrderController';
import { PrismaOrderRepository } from './PrismaOrderRepository';
import { 
  CreatePurchaseOrderUseCase, 
  GetUserOrdersUseCase, 
  GetAllOrdersUseCase, 
  UpdateOrderStatusUseCase 
} from '../application/OrderUseCases';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

const orderRepository = new PrismaOrderRepository();
const createPurchaseOrderUseCase = new CreatePurchaseOrderUseCase(orderRepository);
const getUserOrdersUseCase = new GetUserOrdersUseCase(orderRepository);
const getAllOrdersUseCase = new GetAllOrdersUseCase(orderRepository);
const updateOrderStatusUseCase = new UpdateOrderStatusUseCase(orderRepository);

const orderController = new OrderController(
  createPurchaseOrderUseCase,
  getUserOrdersUseCase,
  getAllOrdersUseCase,
  updateOrderStatusUseCase
);

// Client Routes
router.post('/', authMiddleware, (req, res) => orderController.createPurchaseOrder(req, res));
router.get('/me', authMiddleware, (req, res) => orderController.getMyOrders(req, res));

// Admin Routes
router.get('/all', authMiddleware, adminOnly, (req, res) => orderController.getAllOrders(req, res));
router.patch('/:id/status', authMiddleware, adminOnly, (req, res) => orderController.updateStatus(req, res));

export default router;
