import { ReviewStatus } from "@prisma/client";
import { Request, Response } from "express";
import {
  AdminListReviewsUseCase,
  ApproveReviewUseCase,
  GetMyReviewStateUseCase,
  ListPublicReviewsUseCase,
  RejectReviewUseCase,
  SubmitReviewUseCase,
} from "../application/ReviewUseCases";
import type { Review } from "../domain/Review";

export class ReviewController {
  constructor(
    private listPublicReviewsUseCase: ListPublicReviewsUseCase,
    private getMyReviewStateUseCase: GetMyReviewStateUseCase,
    private submitReviewUseCase: SubmitReviewUseCase,
    private adminListReviewsUseCase: AdminListReviewsUseCase,
    private approveReviewUseCase: ApproveReviewUseCase,
    private rejectReviewUseCase: RejectReviewUseCase,
  ) {}

  private extractId(req: Request) {
    const id = req.params.id;
    if (!id) return null;
    return Array.isArray(id) ? id[0] : id;
  }

  async listPublic(req: Request, res: Response) {
    try {
      const limit = typeof req.query.limit === "number" ? req.query.limit : 12;
      const reviews = await this.listPublicReviewsUseCase.execute(limit);
      return res.json(reviews.map((review) => this.toPublicDto(review)));
    } catch (error: any) {
      console.error("[ReviewController] listPublic failed:", error);
      return res.status(500).json({ error: "Error al obtener reseñas." });
    }
  }

  async getMe(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "UNAUTHORIZED" });
      }
      const state = await this.getMyReviewStateUseCase.execute(userId);
      return res.json(state);
    } catch (error: any) {
      console.error("[ReviewController] getMe failed:", error);
      return res.status(500).json({ error: "Error al obtener tu reseña." });
    }
  }

  async submit(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "UNAUTHORIZED" });
      }
      const review = await this.submitReviewUseCase.execute(userId, req.body.body);
      return res.status(201).json({
        canSubmit: false,
        hasReview: true,
        review: {
          id: review.id,
          body: review.body,
          createdAt: review.createdAt,
        },
      });
    } catch (error: any) {
      if (error?.message === "ACTIVE_REVIEW_EXISTS") {
        return res.status(409).json({ error: "Ya recibimos tu reseña." });
      }
      console.error("[ReviewController] submit failed:", error);
      return res.status(400).json({ error: error?.message || "No se pudo enviar la reseña." });
    }
  }

  async adminList(req: Request, res: Response) {
    try {
      const status = req.query.status as ReviewStatus | undefined;
      const reviews = await this.adminListReviewsUseCase.execute(status);
      return res.json(reviews.map((review) => this.toAdminDto(review)));
    } catch (error: any) {
      console.error("[ReviewController] adminList failed:", error);
      return res.status(500).json({ error: "Error al obtener reseñas." });
    }
  }

  async approve(req: Request, res: Response) {
    try {
      const adminId = (req as any).user?.id;
      if (!adminId) {
        return res.status(401).json({ error: "UNAUTHORIZED" });
      }
      const id = this.extractId(req);
      if (!id) {
        return res.status(400).json({ error: "INVALID_ID" });
      }
      const review = await this.approveReviewUseCase.execute(id, adminId);
      return res.json(this.toAdminDto(review));
    } catch (error: any) {
      return this.handleAdminMutationError(error, res, "No se pudo aprobar la reseña.");
    }
  }

  async reject(req: Request, res: Response) {
    try {
      const adminId = (req as any).user?.id;
      if (!adminId) {
        return res.status(401).json({ error: "UNAUTHORIZED" });
      }
      const id = this.extractId(req);
      if (!id) {
        return res.status(400).json({ error: "INVALID_ID" });
      }
      const review = await this.rejectReviewUseCase.execute(id, adminId);
      return res.json(this.toAdminDto(review));
    } catch (error: any) {
      return this.handleAdminMutationError(error, res, "No se pudo rechazar la reseña.");
    }
  }

  private handleAdminMutationError(error: any, res: Response, fallbackMessage: string) {
    if (error?.message === "REVIEW_NOT_FOUND") {
      return res.status(404).json({ error: "Reseña no encontrada." });
    }
    console.error("[ReviewController] admin mutation failed:", error);
    return res.status(400).json({ error: error?.message || fallbackMessage });
  }

  private toPublicDto(review: Review) {
    return {
      id: review.id,
      body: review.body,
      createdAt: review.approvedAt || review.createdAt,
      user: {
        name: review.user?.name || "Steam User",
        avatar: review.user?.avatar || null,
        profileUrl: review.user?.profileUrl || null,
      },
    };
  }

  private toAdminDto(review: Review) {
    return {
      id: review.id,
      body: review.body,
      status: review.status,
      source: review.source,
      createdAt: review.createdAt,
      approvedAt: review.approvedAt,
      rejectedAt: review.rejectedAt,
      user: {
        id: review.user?.id || review.userId,
        name: review.user?.name || null,
        avatar: review.user?.avatar || null,
        profileUrl: review.user?.profileUrl || null,
        steamId: review.user?.steamId || null,
        email: review.user?.email || null,
      },
    };
  }
}
