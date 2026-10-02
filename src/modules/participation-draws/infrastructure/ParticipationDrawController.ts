import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { ParticipationDraw } from "../domain/ParticipationDraw";
import {
  AddFakeParticipantsToParticipationDrawUseCase,
  CancelParticipationDrawUseCase,
  CreateParticipationDrawUseCase,
  DeleteParticipationDrawUseCase,
  DrawParticipationDrawUseCase,
  GetMyEligibilityUseCase,
  GetParticipationDrawDetailsUseCase,
  ListAdminParticipationDrawsUseCase,
  ListPublicParticipationDrawsUseCase,
  UpdateParticipationDrawUseCase,
} from "../application/ParticipationDrawUseCases";

const AVATAR_TYPES: Record<string, { extension: string; contentType: string }> = {
  jpeg: { extension: ".jpg", contentType: "image/jpeg" },
  png: { extension: ".png", contentType: "image/png" },
  webp: { extension: ".webp", contentType: "image/webp" },
};

function detectAvatarType(buffer: Buffer): keyof typeof AVATAR_TYPES | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

async function saveAvatarUpload(file: Express.Multer.File): Promise<string> {
  if (!file.buffer || file.buffer.length === 0) {
    throw new Error("El avatar está vacío.");
  }

  const detected = detectAvatarType(file.buffer);
  if (!detected) {
    throw new Error("Formato de avatar no permitido. Usá JPG, PNG o WEBP.");
  }
  const avatarType = AVATAR_TYPES[detected]!;

  if (file.mimetype && file.mimetype !== avatarType.contentType) {
    throw new Error("El tipo del avatar no coincide con su contenido real.");
  }

  const dir = path.join(process.cwd(), "storage", "avatars");
  await fs.promises.mkdir(dir, { recursive: true });
  const fileName = `bot_${Date.now()}_${randomUUID()}${avatarType.extension}`;
  await fs.promises.writeFile(path.join(dir, fileName), file.buffer, { flag: "wx" });
  return fileName;
}

export class ParticipationDrawController {
  constructor(
    private listPublicUseCase: ListPublicParticipationDrawsUseCase,
    private listAdminUseCase: ListAdminParticipationDrawsUseCase,
    private getDetailsUseCase: GetParticipationDrawDetailsUseCase,
    private getMyEligibilityUseCase: GetMyEligibilityUseCase,
    private createUseCase: CreateParticipationDrawUseCase,
    private updateUseCase: UpdateParticipationDrawUseCase,
    private cancelUseCase: CancelParticipationDrawUseCase,
    private deleteUseCase: DeleteParticipationDrawUseCase,
    private drawUseCase: DrawParticipationDrawUseCase,
    private addFakeParticipantsUseCase: AddFakeParticipantsToParticipationDrawUseCase,
  ) {}

  async listPublic(_req: Request, res: Response) {
    try {
      const draws = await this.listPublicUseCase.execute();
      return res.json(draws.map((draw) => this.toPublicListDto(draw)));
    } catch (error: any) {
      console.error("[ParticipationDrawController] listPublic failed:", error);
      return res.status(500).json({ error: "Error al obtener sorteos." });
    }
  }

  async listAdmin(_req: Request, res: Response) {
    try {
      const draws = await this.listAdminUseCase.execute();
      return res.json(draws.map((draw) => this.toAdminDto(draw)));
    } catch (error: any) {
      console.error("[ParticipationDrawController] listAdmin failed:", error);
      return res.status(500).json({ error: "Error al obtener sorteos." });
    }
  }

  async getPublicDetails(req: Request, res: Response) {
    try {
      const draw = await this.getDetailsUseCase.execute(req.params.id as string);
      return res.json(this.toPublicDetailDto(draw));
    } catch (error: any) {
      return this.handleReadError(error, res);
    }
  }

  async getAdminDetails(req: Request, res: Response) {
    try {
      const draw = await this.getDetailsUseCase.execute(req.params.id as string, {
        admin: true,
      });
      return res.json(this.toAdminDto(draw));
    } catch (error: any) {
      return this.handleReadError(error, res);
    }
  }

  async getMyEligibility(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      if (!user?.id) {
        return res.status(401).json({ error: "Authorization token required" });
      }

      const eligibility = await this.getMyEligibilityUseCase.execute(
        req.params.id as string,
        user.id,
      );
      return res.json(eligibility);
    } catch (error: any) {
      return this.handleReadError(error, res);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const draw = await this.createUseCase.execute({
        name: req.body.name,
        description: req.body.description ?? null,
        minRaffles: req.body.minRaffles,
        drawDate: new Date(req.body.drawDate),
        isPublic: req.body.isPublic,
        prizes: req.body.prizes,
      });

      return res.status(201).json(this.toAdminDto(draw));
    } catch (error: any) {
      console.error("[ParticipationDrawController] create failed:", error);
      return res
        .status(400)
        .json({ error: error?.message || "No se pudo crear el sorteo." });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const updateInput: {
        name?: string;
        description?: string | null;
        minRaffles?: number;
        drawDate?: Date;
        isPublic?: boolean;
        prizes?: { assetId: string; position: number }[];
      } = {};

      if (req.body.name !== undefined) updateInput.name = req.body.name;
      if (req.body.description !== undefined) updateInput.description = req.body.description;
      if (req.body.minRaffles !== undefined) updateInput.minRaffles = req.body.minRaffles;
      if (req.body.drawDate !== undefined) updateInput.drawDate = new Date(req.body.drawDate);
      if (req.body.isPublic !== undefined) updateInput.isPublic = req.body.isPublic;
      if (req.body.prizes !== undefined) updateInput.prizes = req.body.prizes;

      const draw = await this.updateUseCase.execute(
        req.params.id as string,
        updateInput,
      );

      return res.json(this.toAdminDto(draw));
    } catch (error: any) {
      return this.handleMutationError(error, res, "No se pudo actualizar el sorteo.");
    }
  }

  async cancel(req: Request, res: Response) {
    try {
      const draw = await this.cancelUseCase.execute(req.params.id as string);
      return res.json(this.toAdminDto(draw));
    } catch (error: any) {
      return this.handleMutationError(error, res, "No se pudo cancelar el sorteo.");
    }
  }

  async delete(req: Request, res: Response) {
    try {
      await this.deleteUseCase.execute(req.params.id as string);
      return res.status(204).send();
    } catch (error: any) {
      return this.handleMutationError(error, res, "No se pudo eliminar el sorteo.");
    }
  }

  async draw(req: Request, res: Response) {
    try {
      const draw = await this.drawUseCase.execute(req.params.id as string);
      return res.json(this.toAdminDto(draw));
    } catch (error: any) {
      return this.handleMutationError(error, res, "No se pudo ejecutar el sorteo.");
    }
  }

  async addFakeParticipants(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { mode, name, botId, tickets, chances } = req.body;
      let avatar = req.body.avatar;

      if (req.file) {
        const fileName = await saveAvatarUpload(req.file);
        avatar = `/api/proxy/raffles/avatars/${fileName}`;
      }

      const chancesCount = Number(chances ?? tickets);
      await this.addFakeParticipantsUseCase.execute(id as string, mode, chancesCount, {
        name,
        avatar,
        botId,
      });

      return res.status(200).json({ success: true });
    } catch (error: any) {
      return this.handleMutationError(error, res, "No se pudieron agregar bots.");
    }
  }

  private handleReadError(error: any, res: Response) {
    if (error?.message === "DRAW_NOT_FOUND") {
      return res.status(404).json({ error: "Sorteo no encontrado." });
    }
    console.error("[ParticipationDrawController] read failed:", error);
    return res.status(500).json({ error: "Error al obtener el sorteo." });
  }

  private handleMutationError(error: any, res: Response, fallbackMessage: string) {
    if (error?.message === "DRAW_NOT_FOUND") {
      return res.status(404).json({ error: "Sorteo no encontrado." });
    }
    console.error("[ParticipationDrawController] mutation failed:", error);
    return res.status(400).json({ error: error?.message || fallbackMessage });
  }

  private mapPrize(prize: NonNullable<ParticipationDraw["prizes"]>[number]) {
    return {
      id: prize.id,
      position: prize.position,
      assetId: prize.assetId,
      name: prize.name,
      price: prize.price,
      iconUrl: prize.iconUrl,
      rarity: prize.rarity,
      exterior: prize.exterior,
      float: prize.float,
      pattern: prize.pattern,
      provider: prize.provider,
      winnerId: prize.winnerId,
      winner: prize.winner
        ? {
            id: prize.winner.id,
            name: prize.winner.name,
            avatar: prize.winner.avatar,
            steamId: prize.winner.steamId ?? null,
            tradeUrl: prize.winner.tradeUrl ?? null,
            isFake: Boolean(prize.winner.isFake),
          }
        : null,
    };
  }

  private toPublicListDto(draw: ParticipationDraw) {
    const prizes = (draw.prizes || []).map((prize) => this.mapPrize(prize));
    return {
      id: draw.id,
      name: draw.name,
      description: draw.description,
      minRaffles: draw.minRaffles,
      drawDate: draw.drawDate,
      status: draw.status,
      eligibleCount: draw.eligibleCount ?? 0,
      prizes,
      winners: prizes
        .filter((prize) => prize.winner)
        .map((prize) => ({
          prizeId: prize.id,
          position: prize.position,
          prizeName: prize.name,
          prizeIconUrl: prize.iconUrl,
          winner: prize.winner,
        })),
      createdAt: draw.createdAt,
      updatedAt: draw.updatedAt,
    };
  }

  private toPublicDetailDto(draw: ParticipationDraw) {
    return this.toPublicListDto(draw);
  }

  private toAdminDto(draw: ParticipationDraw) {
    const prizes = (draw.prizes || []).map((prize) => this.mapPrize(prize));
    return {
      id: draw.id,
      name: draw.name,
      description: draw.description,
      minRaffles: draw.minRaffles,
      drawDate: draw.drawDate,
      status: draw.status,
      isPublic: draw.isPublic,
      eligibleCount: draw.eligibleCount ?? 0,
      eligibleUsers: (draw.eligibleUsers || []).map((user) => ({
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        raffleCount: user.raffleCount,
        isBot: Boolean(user.isBot),
        chances: user.chances ?? 1,
      })),
      prizes,
      winners: prizes
        .filter((prize) => prize.winner)
        .map((prize) => ({
          prizeId: prize.id,
          position: prize.position,
          prizeName: prize.name,
          prizeIconUrl: prize.iconUrl,
          winner: prize.winner,
        })),
      createdAt: draw.createdAt,
      updatedAt: draw.updatedAt,
    };
  }
}
