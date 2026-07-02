import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { Raffle, RaffleTicket, IRaffleRepository } from '../domain/Raffle';

const prizeWithWinnerInclude = {
  include: {
    winner: {
      select: { id: true, name: true, steamId: true, avatar: true, tradeUrl: true },
    },
    winningTicket: {
      select: { ticketNumber: true },
    },
  },
} as const;

export class PrismaRaffleRepository implements IRaffleRepository {
  async create(
    data: {
      name: string;
      description?: string | null;
      drawDate: Date;
      ticketPrice: number;
      maxTickets?: number | null;
      status?: string;
    },
    prizes: {
      assetId: string;
      position: number;
      name: string;
      price: number;
      iconUrl?: string | null;
      rarity?: string | null;
      exterior?: string | null;
      float?: number | null;
      pattern?: number | null;
      provider: string;
    }[]
  ): Promise<Raffle> {
    const created = await prisma.raffle.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        drawDate: data.drawDate,
        ticketPrice: data.ticketPrice,
        maxTickets: data.maxTickets ?? null,
        status: data.status || "PENDING",
        prizes: {
          create: prizes.map((p) => ({
            assetId: p.assetId,
            position: p.position,
            name: p.name,
            price: p.price,
            iconUrl: p.iconUrl || null,
            rarity: p.rarity || null,
            exterior: p.exterior || null,
            float: p.float !== undefined ? p.float : null,
            pattern: p.pattern !== undefined ? p.pattern : null,
            provider: p.provider,
          })),
        },
      },
      include: {
        prizes: true,
        tickets: true,
      },
    });
    return created as any;
  }

  async findById(id: string): Promise<Raffle | null> {
    const raffle = await prisma.raffle.findUnique({
      where: { id },
      include: {
        prizes: prizeWithWinnerInclude,
        tickets: {
          include: {
            user: {
              select: { id: true, name: true, steamId: true, avatar: true }
            }
          }
        },
      },
    });
    return raffle as any;
  }

  async findAll(): Promise<Raffle[]> {
    const raffles = await prisma.raffle.findMany({
      include: {
        prizes: prizeWithWinnerInclude,
        tickets: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return raffles as any;
  }

  async findActiveAndFinished(): Promise<Raffle[]> {
    const raffles = await prisma.raffle.findMany({
      where: {
        status: { in: ["PENDING", "ACTIVE", "FINISHED"] },
        isPublic: true,
      },
      include: {
        prizes: prizeWithWinnerInclude,
        tickets: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return raffles as any;
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      drawDate?: Date;
      ticketPrice?: number;
      maxTickets?: number | null;
      status?: string;
      isPublic?: boolean;
    }
  ): Promise<Raffle> {
    const updated = await prisma.raffle.update({
      where: { id },
      data,
      include: {
        prizes: true,
        tickets: true,
      },
    });
    return updated as any;
  }

  async cancelRaffle(id: string): Promise<Raffle> {
    const cancelled = await prisma.raffle.update({
      where: { id },
      data: {
        status: "CANCELLED",
      },
      include: {
        prizes: true,
        tickets: true,
      },
    });
    return cancelled as any;
  }

  async deleteRaffle(id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.rafflePrize.updateMany({
        where: { raffleId: id },
        data: { winningTicketId: null },
      });
      await tx.raffle.delete({ where: { id } });
    });
  }

  async findTicketsByRaffleId(raffleId: string): Promise<RaffleTicket[]> {
    const tickets = await prisma.raffleTicket.findMany({
      where: { raffleId },
      include: {
        user: {
          select: { id: true, name: true, steamId: true, avatar: true }
        }
      },
      orderBy: { ticketNumber: "asc" },
    });
    return tickets as any;
  }

  async findTicketsByUserId(userId: string): Promise<RaffleTicket[]> {
    const tickets = await prisma.raffleTicket.findMany({
      where: { userId },
      include: {
        raffle: {
          include: { prizes: true }
        }
      },
      orderBy: { purchaseDate: "desc" },
    });
    return tickets as any;
  }

  async createTickets(
    tickets: {
      raffleId: string;
      userId: string;
      ticketNumber: number;
      orderId?: string | null;
      status?: string;
    }[]
  ): Promise<RaffleTicket[]> {
    await prisma.raffleTicket.createMany({
      data: tickets.map((t) => ({
        raffleId: t.raffleId,
        userId: t.userId,
        ticketNumber: t.ticketNumber,
        orderId: t.orderId || null,
        status: t.status || "PENDING",
      })),
    });

    const createdTickets = await prisma.raffleTicket.findMany({
      where: {
        raffleId: tickets[0]?.raffleId ?? "",
        orderId: tickets[0]?.orderId ?? null,
      },
    });

    return createdTickets as any;
  }

  async drawWinners(
    raffleId: string,
    winners: {
      prizeId: string;
      winnerId: string;
      winningTicketId: string;
    }[]
  ): Promise<Raffle> {
    await prisma.$transaction(async (tx) => {
      for (const w of winners) {
        await tx.rafflePrize.update({
          where: { id: w.prizeId },
          data: {
            winnerId: w.winnerId,
            winningTicketId: w.winningTicketId,
          },
        });
      }

      await tx.raffle.update({
        where: { id: raffleId },
        data: {
          status: "FINISHED",
        },
      });
    });

    const updated = await this.findById(raffleId);
    if (!updated) {
      throw new Error(`Raffle ${raffleId} was not found after draw completion.`);
    }
    return updated;
  }
}
