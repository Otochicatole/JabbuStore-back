import fs from "fs";
import { Request, Response } from "express";
import type { Sponsor } from "../domain/Sponsor";
import {
  AdminListSponsorsUseCase,
  CreateSponsorUseCase,
  DeleteSponsorUseCase,
  GetSponsorImageUseCase,
  ListPublicSponsorsUseCase,
  ReorderSponsorsUseCase,
  UpdateSponsorUseCase,
} from "../application/SponsorUseCases";
import {
  removeSponsorImage,
  resolveSponsorImagePath,
  saveSponsorImage,
} from "./SponsorImageStorage";

export class SponsorController {
  constructor(
    private listPublicSponsorsUseCase: ListPublicSponsorsUseCase,
    private adminListSponsorsUseCase: AdminListSponsorsUseCase,
    private getSponsorImageUseCase: GetSponsorImageUseCase,
    private createSponsorUseCase: CreateSponsorUseCase,
    private updateSponsorUseCase: UpdateSponsorUseCase,
    private deleteSponsorUseCase: DeleteSponsorUseCase,
    private reorderSponsorsUseCase: ReorderSponsorsUseCase,
  ) {}

  async listPublic(_req: Request, res: Response) {
    try {
      const sponsors = await this.listPublicSponsorsUseCase.execute();
      return res.json(sponsors.map((sponsor) => this.toPublicDto(sponsor)));
    } catch (error: any) {
      console.error("[SponsorController] listPublic failed:", error);
      return res.status(500).json({ error: "Error al obtener sponsors." });
    }
  }

  async adminList(_req: Request, res: Response) {
    try {
      const sponsors = await this.adminListSponsorsUseCase.execute();
      return res.json(sponsors.map((sponsor) => this.toAdminDto(sponsor)));
    } catch (error: any) {
      console.error("[SponsorController] adminList failed:", error);
      return res.status(500).json({ error: "Error al obtener sponsors." });
    }
  }

  async create(req: Request, res: Response) {
    let uploadedImageStorageKey: string | null = null;

    try {
      const image = await saveSponsorImage(req.file);
      uploadedImageStorageKey = image.storageKey;

      const sponsor = await this.createSponsorUseCase.execute({
        name: req.body.name,
        image,
      });

      return res.status(201).json(this.toAdminDto(sponsor));
    } catch (error: any) {
      await removeSponsorImage(uploadedImageStorageKey);
      console.error("[SponsorController] create failed:", error);
      return res.status(400).json({ error: error?.message || "No se pudo crear el sponsor." });
    }
  }

  async update(req: Request, res: Response) {
    let uploadedImageStorageKey: string | null = null;

    try {
      const image = req.file ? await saveSponsorImage(req.file) : undefined;
      uploadedImageStorageKey = image?.storageKey || null;

      const updateInput: Parameters<UpdateSponsorUseCase["execute"]>[1] = {};
      if (req.body.name !== undefined) updateInput.name = req.body.name;
      if (req.body.isActive !== undefined) updateInput.isActive = req.body.isActive;
      if (image !== undefined) updateInput.image = image;

      const result = await this.updateSponsorUseCase.execute(req.params.id as string, updateInput);

      if (result.previousImageStorageKey) {
        await removeSponsorImage(result.previousImageStorageKey);
      }

      return res.json(this.toAdminDto(result.sponsor));
    } catch (error: any) {
      await removeSponsorImage(uploadedImageStorageKey);
      return this.handleMutationError(error, res, "No se pudo actualizar el sponsor.");
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const sponsor = await this.deleteSponsorUseCase.execute(req.params.id as string);
      await removeSponsorImage(sponsor.imageStorageKey);
      return res.status(204).send();
    } catch (error: any) {
      return this.handleMutationError(error, res, "No se pudo eliminar el sponsor.");
    }
  }

  async reorder(req: Request, res: Response) {
    try {
      const sponsors = await this.reorderSponsorsUseCase.execute(req.body.ids);
      return res.json(sponsors.map((sponsor) => this.toAdminDto(sponsor)));
    } catch (error: any) {
      return this.handleMutationError(error, res, "No se pudo reordenar sponsors.");
    }
  }

  async image(req: Request, res: Response) {
    try {
      const sponsor = await this.getSponsorImageUseCase.execute(req.params.id as string);
      const imagePath = resolveSponsorImagePath(sponsor.imageStorageKey);
      await fs.promises.access(imagePath, fs.constants.R_OK);

      res.setHeader("Content-Type", sponsor.imageMimeType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(sponsor.imageOriginalName)}"`,
      );

      return fs.createReadStream(imagePath).pipe(res);
    } catch (error: any) {
      if (error?.message === "SPONSOR_NOT_FOUND" || error?.code === "ENOENT") {
        return res.status(404).json({ error: "Sponsor no encontrado." });
      }
      console.error("[SponsorController] image failed:", error);
      return res.status(500).json({ error: "Error al obtener imagen de sponsor." });
    }
  }

  private handleMutationError(error: any, res: Response, fallbackMessage: string) {
    if (error?.message === "SPONSOR_NOT_FOUND") {
      return res.status(404).json({ error: "Sponsor no encontrado." });
    }
    if (error?.message === "SPONSOR_REORDER_INVALID") {
      return res.status(400).json({ error: "El orden de sponsors es inválido." });
    }
    console.error("[SponsorController] mutation failed:", error);
    return res.status(400).json({ error: error?.message || fallbackMessage });
  }

  private toPublicDto(sponsor: Sponsor) {
    return {
      id: sponsor.id,
      name: sponsor.name,
      displayOrder: sponsor.displayOrder,
      updatedAt: sponsor.updatedAt,
    };
  }

  private toAdminDto(sponsor: Sponsor) {
    return {
      id: sponsor.id,
      name: sponsor.name,
      imageOriginalName: sponsor.imageOriginalName,
      imageMimeType: sponsor.imageMimeType,
      imageSize: sponsor.imageSize,
      displayOrder: sponsor.displayOrder,
      isActive: sponsor.isActive,
      createdAt: sponsor.createdAt,
      updatedAt: sponsor.updatedAt,
    };
  }
}
