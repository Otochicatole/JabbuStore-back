import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFindUnique, mockListingByName, mockGetSettings } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockListingByName: vi.fn(),
  mockGetSettings: vi.fn(),
}));

vi.mock("../../../../shared/infrastructure/PrismaClient", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    storeItem: { findMany: vi.fn().mockResolvedValue([]) },
    floatItem: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("../../../market/application/MarketCatalogService", () => ({
  MarketCatalogService: {
    getListingByName: mockListingByName,
  },
}));

vi.mock("../../application/OrderPricingService", async () => {
  const actual = await vi.importActual<typeof import("../OrderPricingService")>(
    "../OrderPricingService",
  );
  return {
    ...actual,
    getAdminSettingsOrDefaults: mockGetSettings,
  };
});

vi.mock("../WebhookService", () => ({
  WebhookService: { sendOrderNotification: vi.fn() },
}));

vi.mock("../../../notifications/application/NotificationUseCases", () => ({
  CreateOrUpdateNotificationUseCase: class {
    async execute() {
      return null;
    }
  },
}));

import { CreatePurchaseOrderUseCase } from "../OrderUseCases";
import {
  MAX_MARKET_ITEM_QUANTITY,
  resolveOrderItemQuantity,
} from "../OrderPricingService";
import { CheckoutBaseAmountResolver } from "../../../payment-quotes/application/CheckoutBaseAmountResolver";

describe("Global market item quantities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({
      globalPriceModifierType: "percentage_increase",
      globalPriceModifierValue: 0,
      globalPriceModifierEnabled: false,
      userSellModifierType: "percentage_decrease",
      userSellModifierValue: 0,
      userSellModifierEnabled: false,
      marketModifierType: "percentage_increase",
      marketModifierValue: 0,
      marketModifierEnabled: false,
      minimumUserSellPrice: 1,
      mercadoPagoEnabled: true,
      paypalEnabled: true,
      nowpaymentsEnabled: true,
      manualTransferEnabled: false,
    });
    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Buyer",
      email: "buyer@example.com",
      tradeUrl: "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc",
    });
    mockListingByName.mockResolvedValue({
      name: "AK-47 | Redline (Field-Tested)",
      price: 12.5,
      iconUrl: "https://example.com/ak.png",
      rarity: "classified",
      exterior: "Field-Tested",
      provider: "youpin",
    });
  });

  it("clamps quantities between 1 and MAX_MARKET_ITEM_QUANTITY", () => {
    expect(resolveOrderItemQuantity(undefined)).toBe(1);
    expect(resolveOrderItemQuantity(0)).toBe(1);
    expect(resolveOrderItemQuantity(-4)).toBe(1);
    expect(resolveOrderItemQuantity(3.9)).toBe(3);
    expect(resolveOrderItemQuantity(500)).toBe(MAX_MARKET_ITEM_QUANTITY);
  });

  it("computes total base amount and creates one OrderItem per unit for global market orders", async () => {
    const createOrderMock = vi.fn().mockImplementation(async (orderData, itemsData) => ({
      id: "order-1",
      ...orderData,
      items: itemsData,
    }));
    const useCase = new CreatePurchaseOrderUseCase({ create: createOrderMock } as never);
    const resolver = new CheckoutBaseAmountResolver();

    const itemIds = ["market-AK-47 | Redline (Field-Tested)"];
    const items = [
      {
        assetId: "market-AK-47 | Redline (Field-Tested)",
        isSpecific: false,
        quantity: 4,
      },
    ];

    const quoteBase = await resolver.resolve({ type: "BUY", itemIds, items });
    expect(quoteBase).toBe(50);

    const order = await useCase.execute("user-1", itemIds, "paypal", {}, items);
    expect(order.totalPrice).toBe(50);
    expect(createOrderMock).toHaveBeenCalledTimes(1);
    const createdItems = createOrderMock.mock.calls[0]![1];
    expect(createdItems).toHaveLength(4);
    expect(createdItems.every((it: any) => it.price === 12.5 && it.assetId === "market-AK-47 | Redline (Field-Tested)")).toBe(true);
  });
});
