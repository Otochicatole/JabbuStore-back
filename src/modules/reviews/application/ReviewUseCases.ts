import { ReviewStatus } from "@prisma/client";
import type { IReviewRepository, Review } from "../domain/Review";
import type { ReviewEventDispatcher } from "./ReviewEvents";

export class ListPublicReviewsUseCase {
  constructor(private reviewRepository: IReviewRepository) {}

  async execute(limit = 12): Promise<Review[]> {
    return this.reviewRepository.findApproved(limit);
  }
}

export class GetMyReviewStateUseCase {
  constructor(private reviewRepository: IReviewRepository) {}

  async execute(userId: string) {
    const review = await this.reviewRepository.findActiveByUserId(userId);
    return {
      canSubmit: !review,
      hasReview: Boolean(review),
      review: review
        ? {
            id: review.id,
            body: review.body,
            createdAt: review.createdAt,
          }
        : null,
    };
  }
}

export class SubmitReviewUseCase {
  constructor(
    private reviewRepository: IReviewRepository,
    private reviewEvents: ReviewEventDispatcher,
  ) {}

  async execute(userId: string, body: string): Promise<Review> {
    const activeReview = await this.reviewRepository.findActiveByUserId(userId);
    if (activeReview) {
      throw new Error("ACTIVE_REVIEW_EXISTS");
    }

    const review = await this.reviewRepository.createForUser(userId, body.trim());
    await this.reviewEvents.dispatch({ name: "ReviewSubmitted", review });
    return review;
  }
}

export class AdminListReviewsUseCase {
  constructor(private reviewRepository: IReviewRepository) {}

  async execute(status?: ReviewStatus): Promise<Review[]> {
    return this.reviewRepository.findAll(status);
  }
}

export class ApproveReviewUseCase {
  constructor(
    private reviewRepository: IReviewRepository,
    private reviewEvents: ReviewEventDispatcher,
  ) {}

  async execute(id: string, adminId: string): Promise<Review> {
    const review = await this.reviewRepository.approve(id, adminId);
    await this.reviewEvents.dispatch({ name: "ReviewApproved", review });
    return review;
  }
}

export class RejectReviewUseCase {
  constructor(
    private reviewRepository: IReviewRepository,
    private reviewEvents: ReviewEventDispatcher,
  ) {}

  async execute(id: string, adminId: string): Promise<Review> {
    const review = await this.reviewRepository.reject(id, adminId);
    await this.reviewEvents.dispatch({ name: "ReviewRejected", review });
    return review;
  }
}
