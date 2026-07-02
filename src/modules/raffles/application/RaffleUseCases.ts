import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { IRaffleRepository, Raffle, RafflePrize, RaffleTicket } from "../domain/Raffle";
import { PrismaNotificationRepository } from "../../notifications/infrastructure/PrismaNotificationRepository";
import { CreateOrUpdateNotificationUseCase } from "../../notifications/application/NotificationUseCases";

export class CreateRaffleUseCase {
  constructor(private raffleRepository: IRaffleRepository) {}

  async execute(
    data: {
      name: string;
      description?: string | null;
      drawDate: Date;
      ticketPrice: number;
      maxTickets?: number | null;
      status?: string;
    },
    prizesData: { assetId: string; position: number }[]
  ): Promise<Raffle> {
    if (!prizesData || prizesData.length === 0) {
      throw new Error("El sorteo debe tener al menos un premio.");
    }

    const prizes: any[] = [];

    for (const item of prizesData) {
      const assetId = item.assetId;


      // Check if it is a bot item
      if (!assetId.startsWith("youpin-") && !assetId.startsWith("market-")) {
        const storeItem = await prisma.storeItem.findUnique({
          where: { assetId },
        });

        if (!storeItem) {
          throw new Error(`El ítem de bot con ID ${assetId} no existe o no está disponible.`);
        }

        prizes.push({
          assetId,
          position: item.position,
          name: storeItem.name,
          price: storeItem.price,
          iconUrl: storeItem.iconUrl,
          rarity: storeItem.rarity,
          exterior: storeItem.exterior,
          float: storeItem.float,
          pattern: storeItem.pattern,
          provider: "bot",
        });
      } else if (assetId.startsWith("youpin-")) {
        const floatId = assetId.replace(/^youpin-/, "");
        const floatItem = await prisma.floatItem.findUnique({
          where: { id: floatId },
          include: { resaleItem: true },
        });

        if (!floatItem) {
          throw new Error(`El ítem de reventa con ID ${assetId} no existe en el catálogo.`);
        }

        prizes.push({
          assetId,
          position: item.position,
          name: floatItem.resaleItem.name,
          price: floatItem.price,
          iconUrl: floatItem.resaleItem.iconUrl,
          rarity: floatItem.resaleItem.rarity,
          exterior: floatItem.resaleItem.exterior,
          float: floatItem.floatValue,
          pattern: floatItem.paintSeed,
          provider: "youpin",
        });
      } else {
        throw new Error(`Identificador de ítem inválido para sorteos: ${assetId}`);
      }
    }

    return this.raffleRepository.create(data, prizes);
  }
}

export class EditRaffleUseCase {
  constructor(private raffleRepository: IRaffleRepository) {}

  async execute(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      drawDate?: Date;
      ticketPrice?: number;
      maxTickets?: number | null;
      status?: string;
    }
  ): Promise<Raffle> {
    const raffle = await this.raffleRepository.findById(id);
    if (!raffle) {
      throw new Error("Sorteo no encontrado.");
    }

    if (raffle.status !== "PENDING" && raffle.status !== "ACTIVE") {
      if (raffle.status === "CANCELLED") {
        const hasPaidTickets = (raffle.tickets || []).some((t) => t.status === "PAID");
        if (hasPaidTickets) {
          const restrictedFields: (keyof typeof data)[] = ["ticketPrice", "maxTickets", "drawDate"];
          const attemptedRestricted = restrictedFields.filter((f) => data[f] !== undefined);
          if (attemptedRestricted.length > 0) {
            throw new Error(
              "No se puede modificar el precio, máximo de chances ni la fecha de sorteo mientras haya chances vendidas.",
            );
          }
        }

        if (data.status === "ACTIVE" || data.status === "PENDING") {
          return this.raffleRepository.update(id, {
            status: data.status,
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
          });
        }

        if (data.name !== undefined || data.description !== undefined) {
          return this.raffleRepository.update(id, {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
          });
        }
      }

      throw new Error("Solo se pueden editar sorteos pendientes o activos.");
    }

    const hasPaidTickets = (raffle.tickets || []).some((t) => t.status === "PAID");

    if (hasPaidTickets) {
      // Once tickets have been sold, only name, description and status transitions are allowed
      const restrictedFields: (keyof typeof data)[] = ["ticketPrice", "maxTickets", "drawDate"];
      const attemptedRestricted = restrictedFields.filter((f) => data[f] !== undefined);
      if (attemptedRestricted.length > 0) {
        throw new Error(
          "No se puede modificar el precio, máximo de chances ni la fecha de sorteo mientras haya chances vendidas."
        );
      }
    }

    return this.raffleRepository.update(id, data);
  }
}

export class CancelRaffleUseCase {
  constructor(private raffleRepository: IRaffleRepository) {}

  async execute(id: string): Promise<Raffle> {
    const raffle = await this.raffleRepository.findById(id);
    if (!raffle) {
      throw new Error("Sorteo no encontrado.");
    }

    if (raffle.status === "FINISHED") {
      throw new Error("No se puede cancelar un sorteo que ya ha finalizado.");
    }

    // Set to CANCELLED and return.
    // Notice that cancelled raffle prizes are dynamically excluded from catalog locks,
    // so items automatically become available again in standard catalog lists.
    return this.raffleRepository.cancelRaffle(id);
  }
}

export class DeleteRaffleUseCase {
  constructor(private raffleRepository: IRaffleRepository) {}

  async execute(id: string): Promise<void> {
    const raffle = await this.raffleRepository.findById(id);
    if (!raffle) {
      throw new Error("Sorteo no encontrado.");
    }

    if (raffle.status !== "CANCELLED") {
      throw new Error("Solo se pueden eliminar sorteos cancelados.");
    }

    await this.raffleRepository.deleteRaffle(id);
  }
}

export class DrawRaffleUseCase {
  constructor(private raffleRepository: IRaffleRepository) {}

  async execute(id: string): Promise<Raffle> {
    const raffle = await this.raffleRepository.findById(id);
    if (!raffle) {
      throw new Error("Sorteo no encontrado.");
    }

    if (raffle.status === "FINISHED") {
      throw new Error("El sorteo ya ha sido ejecutado previamente.");
    }

    if (raffle.status === "CANCELLED") {
      throw new Error("No se puede ejecutar un sorteo cancelado.");
    }

    const prizes = raffle.prizes || [];
    const tickets = raffle.tickets || [];
    const paidTickets = tickets.filter((t) => t.status === "PAID");

    if (prizes.length === 0) {
      throw new Error("El sorteo no tiene premios asignados.");
    }

    // If there are no tickets sold, transition to finished without winners
    if (paidTickets.length === 0) {
      return this.raffleRepository.update(id, { status: "FINISHED" });
    }

    const winners: { prizeId: string; winnerId: string; winningTicketId: string }[] = [];
    const pool = [...paidTickets];
    const winnerUserIds = new Set<string>();

    const positionsMap = new Map<number, typeof prizes>();
    for (const prize of prizes) {
      const pos = prize.position || 1;
      if (!positionsMap.has(pos)) positionsMap.set(pos, []);
      positionsMap.get(pos)!.push(prize);
    }

    const sortedPositions = Array.from(positionsMap.keys()).sort((a, b) => a - b);

    for (const pos of sortedPositions) {
      if (pool.length === 0) break; // No more tickets to draw from

      const posPrizes = positionsMap.get(pos)!;
      const randomIndex = Math.floor(Math.random() * pool.length);
      const winningTicket = pool[randomIndex]!;

      for (const prize of posPrizes) {
        winners.push({
          prizeId: prize.id,
          winnerId: winningTicket.userId,
          winningTicketId: winningTicket.id,
        });
      }

      winnerUserIds.add(winningTicket.userId);

      // Remove ALL tickets belonging to this winner so they can't win another prize
      for (let i = pool.length - 1; i >= 0; i--) {
        if (pool[i]!.userId === winningTicket.userId) {
          pool.splice(i, 1);
        }
      }
    }

    const updatedRaffle = await this.raffleRepository.drawWinners(id, winners);

    // Send persistent notification to winners
    try {
      const notificationRepository = new PrismaNotificationRepository();
      const notificationUseCase = new CreateOrUpdateNotificationUseCase(notificationRepository);

      for (const winnerInfo of winners) {
        const prize = prizes.find((p) => p.id === winnerInfo.prizeId);
        if (!prize) continue;

        await notificationUseCase.execute({
          userId: winnerInfo.winnerId,
          adminId: null,
          title: "notifications.raffleWon.title",
          content: JSON.stringify({
            key: "notifications.raffleWon.content",
            params: {
              raffleName: raffle.name,
              prizeName: prize.name,
            },
          }),
          type: "SYSTEM",
          link: `/raffles/${raffle.id}`,
        });
      }
    } catch (notificationErr) {
      console.error("[DrawRaffleUseCase] Error sending winner notifications:", notificationErr);
    }

    return updatedRaffle;
  }
}

export class GetClientRafflesUseCase {
  constructor(private raffleRepository: IRaffleRepository) {}

  async execute(): Promise<Raffle[]> {
    return this.raffleRepository.findActiveAndFinished();
  }
}

export class GetAdminRafflesUseCase {
  constructor(private raffleRepository: IRaffleRepository) {}

  async execute(): Promise<Raffle[]> {
    return this.raffleRepository.findAll();
  }
}

export class GetRaffleDetailsUseCase {
  constructor(private raffleRepository: IRaffleRepository) {}

  async execute(id: string): Promise<Raffle | null> {
    return this.raffleRepository.findById(id);
  }
}

export class SetRaffleVisibilityUseCase {
  constructor(private raffleRepository: IRaffleRepository) {}

  async execute(id: string, isPublic: boolean): Promise<Raffle> {
    const raffle = await this.raffleRepository.findById(id);
    if (!raffle) {
      throw new Error("Sorteo no encontrado.");
    }

    if (raffle.status !== "FINISHED") {
      throw new Error("Solo se puede ocultar o mostrar sorteos finalizados.");
    }

    return this.raffleRepository.update(id, { isPublic });
  }
}
