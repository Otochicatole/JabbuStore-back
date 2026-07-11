import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { BotService } from "../../marketplace/application/BotService";
import {
  getAdminSettingsOrDefaults,
  getBotCheckoutPrice,
  getMarketCheckoutPrice,
  roundMoney,
} from "../../orders/application/OrderPricingService";

export interface CheckoutBaseAmountInput {
  type: "BUY" | "raffle";
  itemIds?: string[];
  items?: any[];
  raffleId?: string | null;
  ticketsCount?: number | null;
}

export class CheckoutBaseAmountResolver {
  async resolve(input: CheckoutBaseAmountInput): Promise<number> {
    if (input.type === "raffle") {
      return this.resolveRaffle(input);
    }

    return this.resolveBuy(input);
  }

  private async resolveRaffle(input: CheckoutBaseAmountInput): Promise<number> {
    const raffleId = input.raffleId?.trim();
    const ticketsCount = Math.max(1, Math.trunc(Number(input.ticketsCount || 1)));

    if (!raffleId) {
      throw new Error("Falta el identificador del sorteo.");
    }

    const raffle = await prisma.raffle.findUnique({
      where: { id: raffleId },
      include: { tickets: true },
    });

    if (!raffle) {
      throw new Error("El sorteo no existe.");
    }

    if (raffle.status !== "ACTIVE") {
      throw new Error("El sorteo no está activo.");
    }

    if (raffle.maxTickets) {
      const soldTicketsCount = raffle.tickets.filter((ticket) => ticket.status === "PAID").length;
      if (soldTicketsCount + ticketsCount > raffle.maxTickets) {
        throw new Error("No hay suficientes chances disponibles.");
      }
    }

    return roundMoney(raffle.ticketPrice * ticketsCount);
  }

  private async resolveBuy(input: CheckoutBaseAmountInput): Promise<number> {
    const itemIds = input.itemIds || [];
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      throw new Error("itemIds must be a non-empty array of strings for BUY type");
    }

    const overridesMap = new Map<string, any>();
    if (Array.isArray(input.items)) {
      input.items.forEach((override) => {
        if (override?.assetId) overridesMap.set(override.assetId, override);
      });
    }

    const youpinFloatIds = itemIds
      .filter((id) => id.startsWith("youpin-"))
      .map((id) => id.replace(/^youpin-/, ""));
    const botIds = itemIds.filter(
      (id) => !id.startsWith("market-") && !id.startsWith("youpin-"),
    );
    const marketNames = itemIds
      .filter((id) => id.startsWith("market-"))
      .map((id) => id.replace(/^market-/, ""));

    const [storeItems, marketListings, youpinFloatItems] = await Promise.all([
      botIds.length > 0
        ? prisma.storeItem.findMany({
            where: { assetId: { in: botIds }, marketable: true },
          })
        : Promise.resolve([]),
      marketNames.length > 0
        ? prisma.marketListing.findMany({
            where: { name: { in: marketNames } },
          })
        : Promise.resolve([]),
      youpinFloatIds.length > 0
        ? prisma.floatItem.findMany({
            where: { id: { in: youpinFloatIds }, available: true },
            include: { resaleItem: true },
          })
        : Promise.resolve([]),
    ]);

    const missingBotIds = botIds.filter((id) => !storeItems.some((item) => item.assetId === id));
    if (missingBotIds.length > 0) {
      throw new Error(`Algunos items de bot ya no están disponibles: ${missingBotIds.join(", ")}`);
    }

    if (storeItems.length > 0) {
      await BotService.assertStoreItemsFromActiveBots(storeItems);
    }

    const missingMarketNames = marketNames.filter(
      (name) => !marketListings.some((item) => item.name === name),
    );
    if (missingMarketNames.length > 0) {
      throw new Error(
        `Algunos listings de mercado ya no están disponibles: ${missingMarketNames.join(", ")}`,
      );
    }

    const missingYoupinFloatIds = youpinFloatIds.filter(
      (id) => !youpinFloatItems.some((item) => item.id === id),
    );
    if (missingYoupinFloatIds.length > 0) {
      throw new Error(
        `Algunos assets YouPin ya no están disponibles: ${missingYoupinFloatIds.join(", ")}`,
      );
    }

    const settingsData = await getAdminSettingsOrDefaults();
    let totalPrice = 0;

    for (const botId of botIds) {
      const item = storeItems.find((candidate) => candidate.assetId === botId)!;
      const itemPrice = getBotCheckoutPrice(item.price, settingsData);
      if (!Number.isFinite(itemPrice) || itemPrice <= 0) {
        throw new Error(`El item "${item.name}" no tiene un precio válido para checkout.`);
      }
      totalPrice += itemPrice;
    }

    for (const name of marketNames) {
      const item = marketListings.find((candidate) => candidate.name === name)!;
      const override = overridesMap.get(`market-${name}`);
      let itemPrice = getMarketCheckoutPrice(item.price, settingsData);

      if (override?.float !== undefined && override.float !== null) {
        const floatQueryWhere: any = {
          resaleItemId: item.id,
          floatValue: Number(override.float),
        };
        if (override.pattern !== undefined && override.pattern !== null) {
          floatQueryWhere.paintSeed = Number(override.pattern);
        }
        const dbFloat = await prisma.floatItem.findFirst({ where: floatQueryWhere });
        if (dbFloat) {
          itemPrice = getMarketCheckoutPrice(dbFloat.price, settingsData);
        }
      }

      if (!Number.isFinite(itemPrice) || itemPrice <= 0) {
        throw new Error(`El listing "${name}" no tiene un precio válido para checkout.`);
      }
      totalPrice += itemPrice;
    }

    for (const floatId of youpinFloatIds) {
      const dbFloat = youpinFloatItems.find((candidate) => candidate.id === floatId)!;
      const itemPrice = getMarketCheckoutPrice(dbFloat.price, settingsData);
      if (!Number.isFinite(itemPrice) || itemPrice <= 0) {
        throw new Error(`El asset YouPin "${floatId}" no tiene un precio válido para checkout.`);
      }
      totalPrice += itemPrice;
    }

    return roundMoney(totalPrice);
  }
}
