import { prisma } from "../../../shared/infrastructure/PrismaClient";

type OrderItemLike = {
  assetId: string;
  name: string;
  float?: number | null;
  pattern?: number | null;
  provider?: string | null;
};

export function isYoupinOrderItem(item: OrderItemLike): boolean {
  return (
    item.provider === "youpin" ||
    (typeof item.assetId === "string" &&
      (item.assetId.startsWith("market-") || item.assetId.startsWith("youpin-")))
  );
}

/**
 * Resolves the YouPin listing id (SteamWebAPI `marketid` / `link` field) for a
 * specific float the user purchased. Returns null when no exact match exists.
 */
export async function resolveYoupinExternalId(
  item: OrderItemLike,
): Promise<string | null> {
  if (!isYoupinOrderItem(item)) {
    return null;
  }

  if (item.assetId.startsWith("youpin-")) {
    const floatId = item.assetId.replace(/^youpin-/, "");
    const floatItem = await prisma.floatItem.findFirst({
      where: { assetId: floatId, market: 'YOUPIN' },
      select: { externalId: true },
    });
    return floatItem?.externalId ?? null;
  }

  if (item.float == null || item.float === undefined) {
    return null;
  }

  const marketName = item.assetId.startsWith("market-")
    ? item.assetId.replace(/^market-/, "")
    : item.name;

  const where: {
    listingId: string;
    floatValue: number;
    paintSeed?: number;
  } = {
    listingId: marketName,
    floatValue: Number(item.float),
  };

  if (item.pattern != null && item.pattern !== undefined) {
    where.paintSeed = Number(item.pattern);
  }

  const floatItem = await prisma.floatItem.findFirst({
    where,
    select: { externalId: true },
  });

  return floatItem?.externalId ?? null;
}

export async function enrichOrderItemsWithYoupinLinks<
  T extends OrderItemLike & Record<string, unknown>,
>(items: T[]): Promise<(T & { externalId: string | null })[]> {
  return Promise.all(
    items.map(async (item) => {
      if (!isYoupinOrderItem(item)) {
        return { ...item, externalId: null };
      }

      const externalId = await resolveYoupinExternalId(item);
      return { ...item, externalId };
    }),
  );
}
