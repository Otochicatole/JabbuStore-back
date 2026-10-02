import { Request, Response } from "express";
import type { ParticipationDraw } from "../domain/ParticipationDraw";
import {
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
