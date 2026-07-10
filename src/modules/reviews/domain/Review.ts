import { ReviewSource, ReviewStatus } from "@prisma/client";

export interface ReviewUser {
  id: string;
  name: string | null;
  avatar: string | null;
  profileUrl: string | null;
  steamId?: string | null;
  email?: string | null;
}

export interface Review {
  id: string;
  userId: string;
  user?: ReviewUser;
  body: string;
  status: ReviewStatus;
  source: ReviewSource;
  legacyKey: string | null;
  reviewedByAdminId: string | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReviewRepository {
  findApproved(limit: number): Promise<Review[]>;
  findActiveByUserId(userId: string): Promise<Review | null>;
  createForUser(userId: string, body: string): Promise<Review>;
  findAll(status?: ReviewStatus): Promise<Review[]>;
  findById(id: string): Promise<Review | null>;
  approve(id: string, adminId: string): Promise<Review>;
  reject(id: string, adminId: string): Promise<Review>;
}
