import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatus, OrderType } from "../../domain/Order";

const {
  mockOrderFindUnique,
  mockOrderUpdateMany,
  mockNotificationCreate,
  mockSendDbNotification,
} = vi.hoisted(() => ({
  mockOrderFindUnique: vi.fn(),
  mockOrderUpdateMany: vi.fn(),
  mockNotificationCreate: vi.fn(),
  mockSendDbNotification: vi.fn(),
}));

vi.mock("../../../../shared/infrastructure/PrismaClient", () => ({
  prisma: {
    order: {
      findUnique: mockOrderFindUnique,
      updateMany: mockOrderUpdateMany,
    },
  },
}));

vi.mock("../../../tickets/infrastructure/TicketSocket", () => ({
  sendDbNotification: mockSendDbNotification,
}));

vi.mock("../../../../shared/infrastructure/SendGridService", () => ({
  SendGridService: {
    sendNotificationEmail: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { UpdateOrderStatusUseCase } from "../OrderUseCases";
import { OrderController } from "../../infrastructure/OrderController";

describe("Purchase order bot omission & general notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("OrderController.updateStatus ignores botId for BUY orders and preserves botId for SELL orders", async () => {
    const updateOrderStatusUseCase = {
      execute: vi.fn().mockResolvedValue({ id: "order-1", status: OrderStatus.TRADE_PENDING }),
    };

    const controller = new OrderController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      updateOrderStatusUseCase as never,
      {} as never,
      {} as never,
    );

    const makeRes = () => {
      const res: any = { statusCode: 200 };
      res.status = vi.fn().mockReturnValue(res);
      res.json = vi.fn().mockReturnValue(res);
      return res;
    };

    mockOrderFindUnique.mockResolvedValueOnce({ id: "buy-1", type: OrderType.BUY });
    const buyRes = makeRes();
    await controller.updateStatus(
      { params: { id: "buy-1" }, body: { status: OrderStatus.TRADE_PENDING, botId: "bot-123" } } as never,
      buyRes,
    );
    expect(updateOrderStatusUseCase.execute).toHaveBeenCalledWith(
      "buy-1",
      OrderStatus.TRADE_PENDING,
      undefined,
    );

    mockOrderFindUnique.mockResolvedValueOnce({ id: "sell-1", type: OrderType.SELL });
    const sellRes = makeRes();
    await controller.updateStatus(
      { params: { id: "sell-1" }, body: { status: OrderStatus.TRADE_PENDING, botId: "bot-456" } } as never,
      sellRes,
    );
    expect(updateOrderStatusUseCase.execute).toHaveBeenCalledWith(
      "sell-1",
      OrderStatus.TRADE_PENDING,
      "bot-456",
    );
  });

  it("UpdateOrderStatusUseCase emits general buy trade security notification without botName or botSteamId", async () => {
    mockNotificationCreate.mockImplementation(async (data: any) => ({
      id: `notif-${Math.random()}`,
      ...data,
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const buyOrder = {
      id: "order-buy-1234",
      userId: "user-buy-1",
      type: OrderType.BUY,
      status: OrderStatus.PAID,
      totalPrice: 100,
      items: [],
      metadata: {},
      botId: null,
      bot: null,
    };

    const orderRepo = {
      findById: vi.fn().mockResolvedValue(buyOrder),
      updateStatus: vi.fn().mockResolvedValue({
        ...buyOrder,
        status: OrderStatus.TRADE_PENDING,
      }),
    };

    const notificationRepo = {
      create: mockNotificationCreate,
      findExistingUnread: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };

    const useCase = new UpdateOrderStatusUseCase(orderRepo as never, notificationRepo as never);
    await useCase.execute("order-buy-1234", OrderStatus.TRADE_PENDING);

    const botNotifCall = mockNotificationCreate.mock.calls.find(
      ([arg]: any[]) => arg.title === "notifications.botAssigned.buyTitle",
    );
    expect(botNotifCall).toBeDefined();
    expect(JSON.parse(botNotifCall![0].content)).toEqual({
      key: "notifications.botAssigned.buyContent",
      params: {},
    });
  });

  it("UpdateOrderStatusUseCase still includes botName and botSteamId for SELL orders", async () => {
    mockNotificationCreate.mockImplementation(async (data: any) => ({
      id: `notif-${Math.random()}`,
      ...data,
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const sellOrder = {
      id: "order-sell-1234",
      userId: "user-sell-1",
      type: OrderType.SELL,
      status: OrderStatus.PAID,
      totalPrice: 200,
      items: [],
      metadata: {},
      botId: "bot-1",
      bot: { id: "bot-1", name: "JabbuBot Alpha", steamId: "76561198000000001" },
    };

    const orderRepo = {
      findById: vi.fn().mockResolvedValue(sellOrder),
      updateStatus: vi.fn().mockResolvedValue({
        ...sellOrder,
        status: OrderStatus.TRADE_PENDING,
      }),
    };

    const notificationRepo = {
      create: mockNotificationCreate,
      findExistingUnread: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };

    const useCase = new UpdateOrderStatusUseCase(orderRepo as never, notificationRepo as never);
    await useCase.execute("order-sell-1234", OrderStatus.TRADE_PENDING, "bot-1");

    const botNotifCall = mockNotificationCreate.mock.calls.find(
      ([arg]: any[]) => arg.title === "notifications.botAssigned.title",
    );
    expect(botNotifCall).toBeDefined();
    expect(JSON.parse(botNotifCall![0].content)).toEqual({
      key: "notifications.botAssigned.sellContent",
      params: {
        botName: "JabbuBot Alpha",
        botSteamId: "76561198000000001",
      },
    });
  });
});
