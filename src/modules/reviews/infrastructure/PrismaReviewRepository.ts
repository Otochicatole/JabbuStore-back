import { ReviewSource, ReviewStatus } from "@prisma/client";
import { prisma } from "../../../shared/infrastructure/PrismaClient";
import type { IReviewRepository, Review } from "../domain/Review";

const reviewInclude = {
  user: {
    select: {
      id: true,
      name: true,
      avatar: true,
      profileUrl: true,
      steamId: true,
      email: true,
    },
  },
} as const;

export class PrismaReviewRepository implements IReviewRepository {
  async findApproved(limit: number): Promise<Review[]> {
    return prisma.review.findMany({
      where: { status: ReviewStatus.APPROVED },
      include: reviewInclude,
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
    }) as any;
  }

  async findActiveByUserId(userId: string): Promise<Review | null> {
    return prisma.review.findFirst({
      where: {
        userId,
        status: { in: [ReviewStatus.PENDING, ReviewStatus.APPROVED] },
      },
      include: reviewInclude,
      orderBy: { createdAt: "desc" },
    }) as any;
  }

  async createForUser(userId: string, body: string): Promise<Review> {
    return prisma.review.create({
      data: {
        userId,
        body,
        status: ReviewStatus.PENDING,
        source: ReviewSource.STEAM,
      },
      include: reviewInclude,
    }) as any;
  }

  async findAll(status?: ReviewStatus): Promise<Review[]> {
    return prisma.review.findMany({
      where: status ? { status } : {},
      include: reviewInclude,
      orderBy: [{ createdAt: "desc" }],
    }) as any;
  }

  async findById(id: string): Promise<Review | null> {
    return prisma.review.findUnique({
      where: { id },
      include: reviewInclude,
    }) as any;
  }

  async approve(id: string, adminId: string): Promise<Review> {
    await this.ensureExists(id);
    return prisma.review.update({
      where: { id },
      data: {
        status: ReviewStatus.APPROVED,
        reviewedByAdminId: adminId,
        approvedAt: new Date(),
        rejectedAt: null,
      },
      include: reviewInclude,
    }) as any;
  }

  async reject(id: string, adminId: string): Promise<Review> {
    await this.ensureExists(id);
    return prisma.review.update({
      where: { id },
      data: {
        status: ReviewStatus.REJECTED,
        reviewedByAdminId: adminId,
        rejectedAt: new Date(),
        approvedAt: null,
      },
      include: reviewInclude,
    }) as any;
  }

  private async ensureExists(id: string) {
    const review = await prisma.review.findUnique({ where: { id }, select: { id: true } });
    if (!review) {
      throw new Error("REVIEW_NOT_FOUND");
    }
  }
}
