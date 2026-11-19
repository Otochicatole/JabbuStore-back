import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatus, OrderType } from "../../domain/Order";

const {
  mockOrderFindUnique,
  mockOrderUpdateMany,
  mockUserFindUnique,
  mockRaffleFindUnique,
  mockNotificationExecute,
} = vi.hoisted(() => ({
  mockOrderFindUnique: vi.fn(),
  mockOrderUpdateMany: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockRaffleFindUnique: vi.fn(),
  mockNotificationExecute: vi.fn().mockResolvedValue({ id: "notif-admin" }),
}));

vi.mock("../../../../shared/infrastructure/PrismaClient", () => ({
  prisma: {
    order: {
      findUnique: mockOrderFindUnique,
      updateMany: mockOrderUpdateMany,
    },
    user: {
      findUnique: mockUserFindUnique,
    },
    raffle: {
      findUnique: mockRaffleFindUnique,
    },
  },
}));

vi.mock("../../../notifications/infrastructure/PrismaNotificationRepository", () => ({
  PrismaNotificationRepository: class {},
}));

vi.mock("../../../notifications/application/NotificationUseCases", () => ({
  CreateOrUpdateNotificationUseCase: class {
    execute = mockNotificationExecute;
  },
}));

import { OrderController } from "../OrderController";

describe("OrderController payment confirmation notifications", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("transitions standard order via UpdateOrderStatusUseCase and emits admin notification", async () => {
    const updateOrderStatusUseCase = {
      execute: vi.fn().mockResolvedValue({
        id: "order-12345678",
        userId: "user-1",
        type: OrderType.BUY,
        status: OrderStatus.TRADE_PENDING,
        totalPrice: 45,
        items: [],
      }),
    };

    mockOrderFindUnique.mockResolvedValue({
      id: "order-12345678",
      userId: "user-1",
      type: OrderType.BUY,
      status: OrderStatus.PENDING_PAYMENT,
      totalPrice: 45,
      metadata: {
        paymentQuote: {
          base: { amount: 45, currency: "USD" },
          settlement: { amount: 45000, currency: "ARS" },
        },
      },
    });
    mockOrderUpdateMany.mockResolvedValue({ count: 1 });
    mockUserFindUnique.mockResolvedValue({ name: "Matias" });

    const controller = new OrderController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      updateOrderStatusUseCase as never,
      {} as never,
      {} as never,
    );

    const result = await (controller as any).transitionOrderToTradePendingFromPayment({
      orderId: "order-12345678",
      provider: "mercadopago",
      metadataKey: "mpPaymentId",
      paymentId: "mp-999",
      paidAmount: 45000,
      currency: "ARS",
      expectedCurrency: "ARS",
    });

    expect(result).toEqual({ updated: true });
    expect(updateOrderStatusUseCase.execute).toHaveBeenCalledWith(
      "order-12345678",
      OrderStatus.TRADE_PENDING,
    );
    expect(mockNotificationExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        adminId: null,
        title: "notifications.orderPaymentConfirmedAdmin.title",
        link: "/admin/panel/orders/purchase?id=order-12345678",
      }),
    );
  });

  it("does not emit duplicate notifications when atomic claim returns count 0", async () => {
    const updateOrderStatusUseCase = { execute: vi.fn() };

    mockOrderFindUnique.mockResolvedValue({
      id: "order-12345678",
      userId: "user-1",
      type: OrderType.BUY,
      status: OrderStatus.PENDING_PAYMENT,
      totalPrice: 45,
      metadata: {},
    });
    mockOrderUpdateMany.mockResolvedValue({ count: 0 });

    const controller = new OrderController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      updateOrderStatusUseCase as never,
      {} as never,
      {} as never,
    );

    const result = await (controller as any).transitionOrderToTradePendingFromPayment({
      orderId: "order-12345678",
      provider: "paypal",
      metadataKey: "paypalPaymentId",
      paymentId: "pp-1",
      paidAmount: 45,
      currency: "USD",
    });

    expect(result).toEqual({ updated: false, reason: "invalid_status" });
    expect(updateOrderStatusUseCase.execute).not.toHaveBeenCalled();
    expect(mockNotificationExecute).not.toHaveBeenCalled();
  });
});
