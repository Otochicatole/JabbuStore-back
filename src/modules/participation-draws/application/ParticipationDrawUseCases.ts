import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { MarketCatalogService } from "../../market/application/MarketCatalogService";
import { PrismaNotificationRepository } from "../../notifications/infrastructure/PrismaNotificationRepository";
import { CreateOrUpdateNotificationUseCase } from "../../notifications/application/NotificationUseCases";
import type {
  CreateParticipationDrawInput,
  EligibleUser,
  IParticipationDrawRepository,
  ParticipationDraw,
  ResolvedPrizeData,
  UpdateParticipationDrawInput,
  UserEligibility,
} from "../domain/ParticipationDraw";

async function resolvePrizesFromCatalog(
  prizesData: { assetId: string; position: number }[],
): Promise<ResolvedPrizeData[]> {
  if (!prizesData || prizesData.length === 0) {
    throw new Error("El sorteo debe tener al menos un premio.");
  }

  const prizes: ResolvedPrizeData[] = [];

  for (const item of prizesData) {
    const assetId = item.assetId;

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
      const floatItem = await prisma.floatItem.findFirst({
        where: { assetId: floatId, market: "YOUPIN", available: true },
      });

      if (!floatItem) {
        const floatByUuid = await prisma.floatItem.findUnique({
          where: { id: floatId },
        });
        if (!floatByUuid) {
          throw new Error(`El ítem de reventa con ID ${assetId} no existe en el catálogo.`);
        }

        const listingByUuid = await MarketCatalogService.getListingByName(floatByUuid.listingId);
        prizes.push({
          assetId,
          position: item.position,
          name: listingByUuid?.name ?? floatByUuid.listingId,
          price: floatByUuid.price,
          iconUrl: listingByUuid?.iconUrl || null,
          rarity: listingByUuid?.rarity || "common",
          exterior: listingByUuid?.exterior || null,
          float: floatByUuid.floatValue,
          pattern: floatByUuid.paintSeed,
          provider: "youpin",
        });
        continue;
      }

      const listing = await MarketCatalogService.getListingByName(floatItem.listingId);
      prizes.push({
        assetId,
        position: item.position,
        name: listing?.name ?? floatItem.listingId,
        price: floatItem.price,
        iconUrl: listing?.iconUrl || null,
        rarity: listing?.rarity || "common",
        exterior: listing?.exterior || null,
        float: floatItem.floatValue,
        pattern: floatItem.paintSeed,
        provider: "youpin",
      });
    } else if (assetId.startsWith("market-")) {
      const marketHashName = assetId.replace(/^market-/, "");
      const marketItem = await MarketCatalogService.getListingByName(marketHashName);

      if (!marketItem) {
        throw new Error(`El ítem de mercado "${marketHashName}" no existe en el catálogo.`);
      }

      prizes.push({
        assetId,
        position: item.position,
        name: marketItem.name,
        price: marketItem.price,
        iconUrl: marketItem.iconUrl,
        rarity: marketItem.rarity || "common",
        exterior: marketItem.exterior,
        float: null,
        pattern: null,
        provider: "youpin",
      });
    } else {
      throw new Error(`Identificador de ítem inválido para sorteos: ${assetId}`);
    }
  }

  return prizes;
}

export class ListPublicParticipationDrawsUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(): Promise<ParticipationDraw[]> {
    return this.repository.findPublic();
  }
}

export class ListAdminParticipationDrawsUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(): Promise<ParticipationDraw[]> {
    return this.repository.findAll();
  }
}

export class GetParticipationDrawDetailsUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(id: string, options?: { admin?: boolean }): Promise<ParticipationDraw> {
    const draw = await this.repository.findById(id);
    if (!draw) {
      throw new Error("DRAW_NOT_FOUND");
    }

    if (!options?.admin && (!draw.isPublic || draw.status === "CANCELLED")) {
      throw new Error("DRAW_NOT_FOUND");
    }

    return draw;
  }
}

export class GetMyEligibilityUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(drawId: string, userId: string): Promise<UserEligibility> {
    const draw = await this.repository.findById(drawId);
    if (!draw || !draw.isPublic || draw.status === "CANCELLED") {
      throw new Error("DRAW_NOT_FOUND");
    }

    const raffleCount = await this.repository.getUserRaffleCount(userId);
    return {
      raffleCount,
      eligible: raffleCount >= draw.minRaffles,
      minRaffles: draw.minRaffles,
    };
  }
}

export class CreateParticipationDrawUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(input: {
    name: string;
    description?: string | null;
    minRaffles: number;
    drawDate: Date;
    isPublic?: boolean;
    prizes: { assetId: string; position: number }[];
  }): Promise<ParticipationDraw> {
    if (input.minRaffles < 1) {
      throw new Error("El mínimo de rifas debe ser al menos 1.");
    }
    if (!(input.drawDate instanceof Date) || Number.isNaN(input.drawDate.getTime())) {
      throw new Error("La fecha del sorteo es inválida.");
    }

    const prizes = await resolvePrizesFromCatalog(input.prizes);
    const createInput: CreateParticipationDrawInput = {
      name: input.name,
      description: input.description ?? null,
      minRaffles: input.minRaffles,
      drawDate: input.drawDate,
      prizes,
    };
    if (input.isPublic !== undefined) {
      createInput.isPublic = input.isPublic;
    }
    return this.repository.create(createInput);
  }
}

export class UpdateParticipationDrawUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      minRaffles?: number;
      drawDate?: Date;
      isPublic?: boolean;
      prizes?: { assetId: string; position: number }[];
    },
  ): Promise<ParticipationDraw> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error("DRAW_NOT_FOUND");
    }
    if (existing.status !== "OPEN") {
      throw new Error("Solo se pueden editar sorteos abiertos.");
    }
    if (input.minRaffles !== undefined && input.minRaffles < 1) {
      throw new Error("El mínimo de rifas debe ser al menos 1.");
    }
    if (
      input.drawDate !== undefined &&
      (!(input.drawDate instanceof Date) || Number.isNaN(input.drawDate.getTime()))
    ) {
      throw new Error("La fecha del sorteo es inválida.");
    }

    const updateInput: UpdateParticipationDrawInput = {};
    if (input.name !== undefined) updateInput.name = input.name;
    if (input.description !== undefined) updateInput.description = input.description;
    if (input.minRaffles !== undefined) updateInput.minRaffles = input.minRaffles;
    if (input.drawDate !== undefined) updateInput.drawDate = input.drawDate;
    if (input.isPublic !== undefined) updateInput.isPublic = input.isPublic;

    if (input.prizes) {
      updateInput.prizes = await resolvePrizesFromCatalog(input.prizes);
    }

    return this.repository.update(id, updateInput);
  }
}

export class CancelParticipationDrawUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(id: string): Promise<ParticipationDraw> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error("DRAW_NOT_FOUND");
    }
    if (existing.status !== "OPEN") {
      throw new Error("Solo se pueden cancelar sorteos abiertos.");
    }
    return this.repository.cancel(id);
  }
}

export class DeleteParticipationDrawUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(id: string): Promise<ParticipationDraw> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error("DRAW_NOT_FOUND");
    }
    if (existing.status === "FINISHED") {
      throw new Error("No se puede eliminar un sorteo finalizado.");
    }

    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw new Error("DRAW_NOT_FOUND");
    }
    return deleted;
  }
}

export class DrawParticipationDrawUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(id: string): Promise<ParticipationDraw> {
    const draw = await this.repository.findById(id);
    if (!draw) {
      throw new Error("DRAW_NOT_FOUND");
    }
    if (draw.status !== "OPEN") {
      throw new Error("Solo se pueden sortear sorteos abiertos.");
    }

    const prizes = draw.prizes || [];
    if (prizes.length === 0) {
      throw new Error("El sorteo no tiene premios asignados.");
    }

    const eligibleUsers = await this.repository.findEligibleUsersForDraw(id, draw.minRaffles);
    if (eligibleUsers.length === 0) {
      return this.repository.finishWithoutWinners(id);
    }

    const eligibleById = new Map(eligibleUsers.map((user) => [user.id, user]));
    const prizeWinners: { prizeId: string; winnerId: string; prizeName: string; isBot: boolean }[] =
      [];
    const winnerUserIds = new Set<string>();

    // Premios con ganador agendado: se respetan (no aleatorio)
    const remainingPrizes: typeof prizes = [];
    for (const prize of prizes) {
      const scheduledId = prize.scheduledWinnerId || null;
      if (!scheduledId) {
        remainingPrizes.push(prize);
        continue;
      }

      const winner = eligibleById.get(scheduledId);
      if (!winner) {
        throw new Error(
          `El ganador agendado para "${prize.name}" ya no es elegible. Reasignalo o quitá la agenda.`,
        );
      }
      if (winnerUserIds.has(scheduledId)) {
        throw new Error("Hay ganadores agendados duplicados entre premios.");
      }

      winnerUserIds.add(scheduledId);
      prizeWinners.push({
        prizeId: prize.id,
        winnerId: winner.id,
        prizeName: prize.name,
        isBot: Boolean(winner.isBot),
      });
    }

    // Premios sin agenda: sorteo aleatorio con el resto del pool
    if (remainingPrizes.length > 0) {
      const pool: EligibleUser[] = [];
      for (const user of eligibleUsers) {
        if (winnerUserIds.has(user.id)) continue;
        const weight = Math.max(1, user.chances || 1);
        for (let i = 0; i < weight; i++) {
          pool.push(user);
        }
      }

      const positionsMap = new Map<number, typeof remainingPrizes>();
      for (const prize of remainingPrizes) {
        const pos = prize.position || 1;
        if (!positionsMap.has(pos)) positionsMap.set(pos, []);
        positionsMap.get(pos)!.push(prize);
      }

      const sortedPositions = Array.from(positionsMap.keys()).sort((a, b) => a - b);

      for (const pos of sortedPositions) {
        if (pool.length === 0) break;

        const posPrizes = positionsMap.get(pos)!;
        const randomIndex = Math.floor(Math.random() * pool.length);
        const winningUser = pool[randomIndex]!;

        for (const prize of posPrizes) {
          prizeWinners.push({
            prizeId: prize.id,
            winnerId: winningUser.id,
            prizeName: prize.name,
            isBot: Boolean(winningUser.isBot),
          });
        }

        winnerUserIds.add(winningUser.id);
        for (let i = pool.length - 1; i >= 0; i--) {
          if (pool[i]?.id === winningUser.id) {
            pool.splice(i, 1);
          }
        }
      }
    }

    if (prizeWinners.length === 0) {
      return this.repository.finishWithoutWinners(id);
    }

    const finished = await this.repository.finishDraw(
      id,
      prizeWinners.map(({ prizeId, winnerId }) => ({ prizeId, winnerId })),
      eligibleUsers.map((user) => ({
        userId: user.id,
        raffleCount: user.raffleCount,
        isWinner: winnerUserIds.has(user.id),
      })),
    );

    try {
      const notificationRepository = new PrismaNotificationRepository();
      const notificationUseCase = new CreateOrUpdateNotificationUseCase(notificationRepository);

      for (const winnerInfo of prizeWinners) {
        if (winnerInfo.isBot) continue;

        await notificationUseCase.execute({
          userId: winnerInfo.winnerId,
          adminId: null,
          title: "notifications.participationDrawWon.title",
          content: JSON.stringify({
            key: "notifications.participationDrawWon.content",
            params: {
              drawName: draw.name,
              prizeName: winnerInfo.prizeName,
            },
          }),
          type: "SYSTEM",
          link: `/participation-draws/${draw.id}?prize=${winnerInfo.prizeId}`,
        });
      }
    } catch (notificationErr) {
      console.error(
        "[DrawParticipationDrawUseCase] Error sending winner notifications:",
        notificationErr,
      );
    }

    return finished;
  }
}

export class ScheduleParticipationDrawWinnersUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(
    id: string,
    assignments: { prizeId: string; winnerId: string | null }[],
  ): Promise<ParticipationDraw> {
    const draw = await this.repository.findById(id);
    if (!draw) {
      throw new Error("DRAW_NOT_FOUND");
    }
    if (draw.status !== "OPEN") {
      throw new Error("Solo se pueden agendar ganadores en sorteos abiertos.");
    }

    const prizes = draw.prizes || [];
    if (prizes.length === 0) {
      throw new Error("El sorteo no tiene premios asignados.");
    }

    const eligibleUsers = await this.repository.findEligibleUsersForDraw(id, draw.minRaffles);
    const eligibleById = new Map(eligibleUsers.map((user) => [user.id, user]));
    const prizeById = new Map(prizes.map((prize) => [prize.id, prize]));
    const seenWinners = new Set<string>();

    // Completar con null para premios no enviados: no tocarlos. Solo actualizar los del payload.
    const normalized = assignments.map((assignment) => {
      if (!prizeById.has(assignment.prizeId)) {
        throw new Error("Uno de los premios asignados no pertenece a este sorteo.");
      }
      if (!assignment.winnerId) {
        return { prizeId: assignment.prizeId, winnerId: null };
      }
      if (!eligibleById.has(assignment.winnerId)) {
        throw new Error("Uno de los ganadores elegidos no es elegible para este sorteo.");
      }
      if (seenWinners.has(assignment.winnerId)) {
        throw new Error("Un mismo participante no puede estar agendado en más de un premio.");
      }
      seenWinners.add(assignment.winnerId);
      return { prizeId: assignment.prizeId, winnerId: assignment.winnerId };
    });

    // También validar contra agendas existentes que no se están cambiando
    for (const prize of prizes) {
      const incoming = normalized.find((item) => item.prizeId === prize.id);
      const effectiveWinnerId =
        incoming !== undefined ? incoming.winnerId : prize.scheduledWinnerId || null;
      if (!effectiveWinnerId) continue;
      if (incoming === undefined && seenWinners.has(effectiveWinnerId)) {
        throw new Error("Un mismo participante no puede estar agendado en más de un premio.");
      }
      if (incoming === undefined) {
        seenWinners.add(effectiveWinnerId);
      }
    }

    return this.repository.scheduleWinners(id, normalized);
  }
}

export class AddFakeParticipantsToParticipationDrawUseCase {
  constructor(private repository: IParticipationDrawRepository) {}

  async execute(
    id: string,
    mode: "new" | "existing",
    chances: number,
    botData?: { name?: string; avatar?: string; botId?: string },
  ): Promise<void> {
    if (!Number.isFinite(chances) || chances < 1) {
      throw new Error("La cantidad de chances debe ser al menos 1.");
    }

    const draw = await this.repository.findById(id);
    if (!draw) {
      throw new Error("DRAW_NOT_FOUND");
    }
    if (draw.status !== "OPEN") {
      throw new Error("Solo se pueden agregar bots a sorteos abiertos.");
    }

    let fakeUser: { id: string; isFake: boolean } | null = null;

    if (mode === "new") {
      const name = botData?.name || `Bot_${Math.floor(Math.random() * 1000)}`;
      const avatar =
        botData?.avatar ||
        "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg";
      const steamId = `FAKE_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      fakeUser = await prisma.user.create({
        data: {
          isFake: true,
          name,
          avatar,
          steamId,
        },
      });
    } else {
      if (!botData?.botId) throw new Error("ID de bot no proporcionado.");
      const existing = await prisma.user.findUnique({ where: { id: botData.botId } });
      if (!existing || !existing.isFake) throw new Error("Bot no encontrado o inválido.");
      fakeUser = existing;
    }

    await this.repository.addBotEntry(id, fakeUser.id, Math.floor(chances));
  }
}
