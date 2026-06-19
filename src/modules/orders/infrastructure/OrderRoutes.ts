import { Router } from "express";
import { OrderController } from "./OrderController";
import { PrismaOrderRepository } from "./PrismaOrderRepository";
import {
  CreatePurchaseOrderUseCase,
  CreateSellOrderUseCase,
  GetUserOrdersUseCase,
  GetAllOrdersUseCase,
  UpdateOrderStatusUseCase,
} from "../application/OrderUseCases";
import {
  authMiddleware,
  adminOnly,
} from "../../../shared/infrastructure/middlewares/authMiddleware";

const router = Router();

const orderRepository = new PrismaOrderRepository();
const createPurchaseOrderUseCase = new CreatePurchaseOrderUseCase(
  orderRepository,
);
const createSellOrderUseCase = new CreateSellOrderUseCase(orderRepository);
const getUserOrdersUseCase = new GetUserOrdersUseCase(orderRepository);
const getAllOrdersUseCase = new GetAllOrdersUseCase(orderRepository);
const updateOrderStatusUseCase = new UpdateOrderStatusUseCase(orderRepository);

const orderController = new OrderController(
  createPurchaseOrderUseCase,
  createSellOrderUseCase,
  getUserOrdersUseCase,
  getAllOrdersUseCase,
  updateOrderStatusUseCase,
);

// Client Routes
router.post("/", authMiddleware, (req, res) =>
  orderController.createPurchaseOrder(req, res),
);
router.post("/sell", authMiddleware, (req, res) =>
  orderController.createSellOrder(req, res),
);
router.post("/validate", authMiddleware, (req, res) =>
  orderController.validateOrder(req, res),
);
router.get("/me", authMiddleware, (req, res) =>
  orderController.getMyOrders(req, res),
);
router.patch("/:id/cancel-payment", authMiddleware, (req, res) =>
  orderController.cancelPaymentOrder(req, res),
);

// Public Webhook (Sin autenticación para recibir notificaciones asíncronas de Mercado Pago)
router.post("/webhook/mercadopago", (req, res) =>
  orderController.handleMercadoPagoWebhook(req, res),
);

// Public Webhook NOWPayments (Sin autenticación para recibir notificaciones asíncronas de NOWPayments)
router.post("/webhook/nowpayments", (req, res) =>
  orderController.handleNOWPaymentsWebhook(req, res),
);

// Public Webhook/Callback PayPal para capturar el pago tras la aprobación del cliente
router.post("/webhook/paypal", (req, res) =>
  orderController.handlePayPalWebhook(req, res),
);

// Admin Routes
router.get("/all", authMiddleware, adminOnly, (req, res) =>
  orderController.getAllOrders(req, res),
);
router.patch("/:id/status", authMiddleware, adminOnly, (req, res) =>
  orderController.updateStatus(req, res),
);

export default router;
