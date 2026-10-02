import { prisma } from "../../../shared/infrastructure/PrismaClient";
import type {
  CreateParticipationDrawInput,
  EligibleUser,
  IParticipationDrawRepository,
  ParticipationDraw,
  PrizeWinnerAssignment,
  UpdateParticipationDrawInput,
} from "../domain/ParticipationDraw";

const winnerSelect = {
  id: true,
  name: true,
  avatar: true,
  steamId: true,
  tradeUrl: true,
  isFake: true,
} as const;

const prizeInclude = {
  winner: { select: winnerSelect },
} as const;

const entryInclude = {
  user: { select: winnerSelect },
} as const;

const drawInclude = {
  prizes: {
    include: prizeInclude,
    orderBy: [{ position: "asc" as const }, { name: "asc" as const }],
  },
};

function mapDraw(draw: any): ParticipationDraw {
  return {
    ...draw,
    eligibleCount: draw.eligibleCount,
    eligibleUsers: draw.eligibleUsers,
  };
}

export class PrismaParticipationDrawRepository implements IParticipationDrawRepository {
  private async withEligibility(draw: any): Promise<ParticipationDraw> {
    if (draw.status === "FINISHED") {
      const eligibleCount = await prisma.participationDrawEntry.count({
        where: { drawId: draw.id },
      });
      return mapDraw({ ...draw, eligibleCount });
    }

    const eligibleUsers = await this.findEligibleUsersForDraw(draw.id, draw.minRaffles);
    return mapDraw({
      ...draw,
      eligibleUsers,
      eligibleCount: eligibleUsers.length,
    });
  }

  async findPublic(): Promise<ParticipationDraw[]> {
    const draws = await prisma.participationDraw.findMany({
      where: {
        isPublic: true,
        status: { in: ["OPEN", "FINISHED"] },
      },
      include: drawInclude,
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(draws.map((draw) => this.withEligibility(draw)));
  }

  async findAll(): Promise<ParticipationDraw[]> {
    const draws = await prisma.participationDraw.findMany({
      include: drawInclude,
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(draws.map((draw) => this.withEligibility(draw)));
  }

  async findById(id: string): Promise<ParticipationDraw | null> {
    const draw = await prisma.participationDraw.findUnique({
      where: { id },
      include: {
        ...drawInclude,
        entries: {
          include: entryInclude,
          orderBy: [{ isWinner: "desc" }, { raffleCount: "desc" }],
        },
      },
    });

    if (!draw) return null;

    if (draw.status === "FINISHED") {
      const eligibleUsers: EligibleUser[] = (draw.entries || []).map((entry) => ({
        id: entry.userId,
        name: entry.user?.name ?? null,
        avatar: entry.user?.avatar ?? null,
        raffleCount: entry.raffleCount,
        isBot: Boolean((entry.user as { isFake?: boolean } | null)?.isFake),
        chances: 1,
      }));
      return mapDraw({
        ...draw,
        eligibleUsers,
        eligibleCount: eligibleUsers.length,
      });
    }

    const eligibleUsers = await this.findEligibleUsersForDraw(draw.id, draw.minRaffles);
    return mapDraw({
      ...draw,
      eligibleUsers,
      eligibleCount: eligibleUsers.length,
    });
  }

  async findDrawsReadyToDraw(): Promise<ParticipationDraw[]> {
    const draws = await prisma.participationDraw.findMany({
      where: {
        status: "OPEN",
        drawDate: { lte: new Date() },
      },
      include: drawInclude,
      orderBy: { drawDate: "asc" },
    });
    return draws.map((draw) => mapDraw(draw));
  }

  async create(input: CreateParticipationDrawInput): Promise<ParticipationDraw> {
    const draw = await prisma.participationDraw.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        minRaffles: input.minRaffles,
        drawDate: input.drawDate,
        isPublic: input.isPublic ?? true,
        status: "OPEN",
        prizes: {
          create: input.prizes.map((prize) => ({
            assetId: prize.assetId,
            position: prize.position,
            name: prize.name,
            price: prize.price,
            iconUrl: prize.iconUrl,
            rarity: prize.rarity,
            exterior: prize.exterior,
            float: prize.float,
            pattern: prize.pattern,
            provider: prize.provider,
          })),
        },
      },
      include: drawInclude,
    });

    return this.withEligibility(draw);
  }

  async update(id: string, input: UpdateParticipationDrawInput): Promise<ParticipationDraw> {
    await prisma.$transaction(async (tx) => {
      if (input.prizes) {
        await tx.participationDrawPrize.deleteMany({ where: { drawId: id } });
        await tx.participationDrawPrize.createMany({
          data: input.prizes.map((prize) => ({
            drawId: id,
            assetId: prize.assetId,
            position: prize.position,
            name: prize.name,
            price: prize.price,
            iconUrl: prize.iconUrl,
            rarity: prize.rarity,
            exterior: prize.exterior,
            float: prize.float,
            pattern: prize.pattern,
            provider: prize.provider,
          })),
        });
      }

      await tx.participationDraw.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.minRaffles !== undefined ? { minRaffles: input.minRaffles } : {}),
          ...(input.drawDate !== undefined ? { drawDate: input.drawDate } : {}),
          ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        },
      });
    });

    const draw = await this.findById(id);
    if (!draw) throw new Error("DRAW_NOT_FOUND");
    return draw;
  }

  async cancel(id: string): Promise<ParticipationDraw> {
    const draw = await prisma.participationDraw.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: drawInclude,
    });
    return mapDraw({ ...draw, eligibleCount: 0, eligibleUsers: [] });
  }

  async delete(id: string): Promise<ParticipationDraw | null> {
    const draw = await prisma.participationDraw.findUnique({
      where: { id },
      include: drawInclude,
    });
    if (!draw) return null;

    await prisma.participationDraw.delete({ where: { id } });
    return mapDraw(draw);
  }

  async findEligibleUsers(minRaffles: number): Promise<EligibleUser[]> {
    const tickets = await prisma.raffleTicket.findMany({
      where: {
        status: "PAID",
        user: { isFake: false },
      },
      select: {
        userId: true,
        raffleId: true,
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    const byUser = new Map<
      string,
      { name: string | null; avatar: string | null; raffleIds: Set<string> }
    >();

    for (const ticket of tickets) {
      const existing = byUser.get(ticket.userId);
      if (existing) {
        existing.raffleIds.add(ticket.raffleId);
        continue;
      }

      byUser.set(ticket.userId, {
        name: ticket.user.name,
        avatar: ticket.user.avatar,
        raffleIds: new Set([ticket.raffleId]),
      });
    }

    return Array.from(byUser.entries())
      .map(([id, data]) => ({
        id,
        name: data.name,
        avatar: data.avatar,
        raffleCount: data.raffleIds.size,
        isBot: false,
        chances: 1,
      }))
      .filter((user) => user.raffleCount >= minRaffles)
      .sort((a, b) => {
        if (b.raffleCount !== a.raffleCount) return b.raffleCount - a.raffleCount;
        return (a.name || "").localeCompare(b.name || "");
      });
  }

  async findEligibleUsersForDraw(drawId: string, minRaffles: number): Promise<EligibleUser[]> {
    const realUsers = await this.findEligibleUsers(minRaffles);
    const botEntries = await prisma.participationDrawBotEntry.findMany({
      where: { drawId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
            isFake: true,
          },
        },
      },
    });

    const merged = [...realUsers];
    const seen = new Set(realUsers.map((user) => user.id));

    for (const entry of botEntries) {
      if (seen.has(entry.userId)) {
        const existing = merged.find((user) => user.id === entry.userId);
        if (existing) {
          existing.chances = (existing.chances || 1) + entry.chances;
          existing.isBot = true;
        }
        continue;
      }

      seen.add(entry.userId);
      merged.push({
        id: entry.userId,
        name: entry.user.name,
        avatar: entry.user.avatar,
        raffleCount: minRaffles,
        isBot: true,
        chances: entry.chances,
      });
    }

    return merged.sort((a, b) => {
      if (Boolean(a.isBot) !== Boolean(b.isBot)) return a.isBot ? 1 : -1;
      if (b.raffleCount !== a.raffleCount) return b.raffleCount - a.raffleCount;
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  async addBotEntry(drawId: string, userId: string, chances: number): Promise<void> {
    const existing = await prisma.participationDrawBotEntry.findUnique({
      where: {
        drawId_userId: { drawId, userId },
      },
    });

    if (existing) {
      await prisma.participationDrawBotEntry.update({
        where: { id: existing.id },
        data: { chances: existing.chances + chances },
      });
      return;
    }

    await prisma.participationDrawBotEntry.create({
      data: {
        drawId,
        userId,
        chances,
      },
    });
  }

  async getUserRaffleCount(userId: string): Promise<number> {
    const tickets = await prisma.raffleTicket.findMany({
      where: {
        userId,
        status: "PAID",
      },
      select: { raffleId: true },
      distinct: ["raffleId"],
    });

    return tickets.length;
  }

  async finishDraw(
    id: string,
    prizeWinners: PrizeWinnerAssignment[],
    entries: { userId: string; raffleCount: number; isWinner: boolean }[],
  ): Promise<ParticipationDraw> {
    await prisma.$transaction(async (tx) => {
      const current = await tx.participationDraw.findUnique({ where: { id } });
      if (!current) {
        throw new Error("DRAW_NOT_FOUND");
      }
      if (current.status !== "OPEN") {
        throw new Error("Solo se pueden sortear sorteos abiertos.");
      }

      await tx.participationDrawEntry.createMany({
        data: entries.map((entry) => ({
          drawId: id,
          userId: entry.userId,
          raffleCount: entry.raffleCount,
          isWinner: entry.isWinner,
        })),
      });

      for (const assignment of prizeWinners) {
        await tx.participationDrawPrize.update({
          where: { id: assignment.prizeId },
          data: { winnerId: assignment.winnerId },
        });
      }

      await tx.participationDraw.update({
        where: { id },
        data: { status: "FINISHED" },
      });
    });

    const draw = await this.findById(id);
    if (!draw) {
      throw new Error("DRAW_NOT_FOUND");
    }
    return draw;
  }

  async finishWithoutWinners(id: string): Promise<ParticipationDraw> {
    await prisma.$transaction(async (tx) => {
      const current = await tx.participationDraw.findUnique({ where: { id } });
      if (!current) {
        throw new Error("DRAW_NOT_FOUND");
      }
      if (current.status !== "OPEN") {
        throw new Error("Solo se pueden sortear sorteos abiertos.");
      }

      await tx.participationDraw.update({
        where: { id },
        data: { status: "FINISHED" },
      });
    });

    const draw = await this.findById(id);
    if (!draw) {
      throw new Error("DRAW_NOT_FOUND");
    }
    return draw;
  }
}
