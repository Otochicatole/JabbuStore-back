import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { QuoteStatus } from "@prisma/client";
import { PrismaNotificationRepository } from "../../notifications/infrastructure/PrismaNotificationRepository";
import { CreateOrUpdateNotificationUseCase } from "../../notifications/application/NotificationUseCases";

export class CreateQuoteUseCase {
  async execute(userId: string, assetIds: string[]): Promise<any> {
    if (!assetIds || assetIds.length === 0) {
      throw new Error("No se proporcionaron artículos para cotizar.");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.email?.trim() || !user.tradeUrl?.trim()) {
      throw new Error("Para realizar cotizaciones debes tener registrado tu Email y Trade URL en tu perfil.");
    }

    // Check if user has active/pending quotes for any of these items, or active skin listing
    for (const assetId of assetIds) {
      const inventoryItem = await prisma.userInventoryItem.findFirst({
        where: { userId, assetId },
      });

      if (!inventoryItem) {
        throw new Error(`El item ${assetId} no se encuentra en tu inventario.`);
      }

      // Check if it already has a pending or quoted quote request
      const activeQuote = await prisma.quote.findFirst({
        where: {
          userId,
          status: { in: [QuoteStatus.PENDING, QuoteStatus.QUOTED] },
          items: { some: { assetId } },
        },
      });

      if (activeQuote) {
        throw new Error(`El item "${inventoryItem.name}" ya tiene una solicitud de cotización en curso.`);
      }

      // Check if it is already listed
      const alreadyListed = await prisma.skinListing.findFirst({
        where: {
          skinId: assetId,
          status: { in: ["active", "reserved"] },
        },
      });

      if (alreadyListed) {
        throw new Error(`El item "${inventoryItem.name}" ya está listado para la venta.`);
      }
    }

    // Resolve items details
    const resolvedItems = await Promise.all(
      assetIds.map(async (assetId) => {
        const inventoryItem = await prisma.userInventoryItem.findFirst({
          where: { userId, assetId },
        });

        return {
          assetId,
          name: inventoryItem!.name,
          iconUrl: inventoryItem!.iconUrl ?? null,
          rarity: inventoryItem!.rarity,
          exterior: inventoryItem!.exterior,
          float: inventoryItem!.float,
          pattern: inventoryItem!.pattern,
          paintIndex: inventoryItem!.paintIndex,
        };
      })
    );

    // Create quote and items in transaction
    const quote = await prisma.quote.create({
      data: {
        userId,
        status: QuoteStatus.PENDING,
        items: {
          create: resolvedItems,
        },
      },
      include: {
        items: true,
      },
    });

    return quote;
  }
}

export class GetUserQuotesUseCase {
  async execute(userId: string): Promise<any[]> {
    return prisma.quote.findMany({
      where: { userId },
      include: {
        items: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }
}

export class GetQuoteByIdUseCase {
  async execute(id: string, userId?: string): Promise<any> {
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!quote) {
      throw new Error("Cotización no encontrada.");
    }

    if (userId && quote.userId !== userId) {
      throw new Error("No tienes acceso a esta cotización.");
    }

    return quote;
  }
}

export class CancelQuoteUseCase {
  async execute(id: string, userId?: string): Promise<any> {
    const quote = await prisma.quote.findUnique({
      where: { id },
    });

    if (!quote) {
      throw new Error("Cotización no encontrada.");
    }

    if (userId && quote.userId !== userId) {
      throw new Error("No tienes autorización para cancelar esta cotización.");
    }

    if (quote.status === QuoteStatus.ACCEPTED) {
      throw new Error("No se puede cancelar una cotización que ya ha sido aceptada.");
    }

    if (quote.status === QuoteStatus.CANCELLED) {
      return quote;
    }

    return prisma.quote.update({
      where: { id },
      data: {
        status: QuoteStatus.CANCELLED,
      },
      include: {
        items: true,
      },
    });
  }
}

export class AdminGetQuotesUseCase {
  async execute(): Promise<any[]> {
    return prisma.quote.findMany({
      include: {
        items: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            steamId: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }
}

export class AdminQuoteItemsUseCase {
  async execute(
    quoteId: string,
    prices: { assetId: string; price: number }[]
  ): Promise<any> {
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true },
    });

    if (!quote) {
      throw new Error("Cotización no encontrada.");
    }

    if (quote.status !== QuoteStatus.PENDING && quote.status !== QuoteStatus.QUOTED) {
      throw new Error("Solo se pueden cotizar solicitudes pendientes o previamente cotizadas.");
    }

    // Update prices inside transaction
    await prisma.$transaction(
      prices.map((p) =>
        prisma.quoteItem.updateMany({
          where: {
            quoteId,
            assetId: p.assetId,
          },
          data: {
            price: p.price,
          },
        })
      )
    );

    // Update quote status to QUOTED
    const updatedQuote = await prisma.quote.update({
      where: { id: quoteId },
      data: {
        status: QuoteStatus.QUOTED,
      },
      include: {
        items: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    // Send persistent notification to user
    try {
      const notificationRepository = new PrismaNotificationRepository();
      const notificationUseCase = new CreateOrUpdateNotificationUseCase(
        notificationRepository
      );

      await notificationUseCase.execute({
        userId: updatedQuote.userId,
        adminId: null,
        title: "Cotización respondida",
        content: `El administrador ha cotizado los ítems de tu solicitud #${quoteId.slice(0, 8)}.`,
        type: "ORDER_STATUS",
        link: "/quotes",
      });
    } catch (err) {
      console.error("[AdminQuoteItemsUseCase] Error sending notification:", err);
    }

    return updatedQuote;
  }
}
