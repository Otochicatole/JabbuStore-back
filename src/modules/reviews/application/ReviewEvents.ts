import { PrismaNotificationRepository } from "../../notifications/infrastructure/PrismaNotificationRepository";
import { CreateOrUpdateNotificationUseCase } from "../../notifications/application/NotificationUseCases";
import type { Review } from "../domain/Review";

export type ReviewEventName = "ReviewSubmitted" | "ReviewApproved" | "ReviewRejected";

export interface ReviewEvent {
  name: ReviewEventName;
  review: Review;
}

type ReviewEventHandler = (event: ReviewEvent) => Promise<void>;

export class ReviewEventDispatcher {
  private handlers: Partial<Record<ReviewEventName, ReviewEventHandler[]>> = {};

  on(name: ReviewEventName, handler: ReviewEventHandler) {
    this.handlers[name] = [...(this.handlers[name] || []), handler];
  }

  async dispatch(event: ReviewEvent) {
    const handlers = this.handlers[event.name] || [];
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          console.error(`[ReviewEventDispatcher] ${event.name} handler failed:`, error);
        }
      }),
    );
  }
}

export function createReviewEventDispatcher() {
  const dispatcher = new ReviewEventDispatcher();
  const notificationRepository = new PrismaNotificationRepository();
  const notificationUseCase = new CreateOrUpdateNotificationUseCase(notificationRepository);

  dispatcher.on("ReviewSubmitted", async ({ review }) => {
    await notificationUseCase.execute({
      title: "notifications.newReview.title",
      content: JSON.stringify({
        key: "notifications.newReview.content",
        params: { userName: review.user?.name || "Steam User" },
      }),
      type: "SYSTEM",
      link: "/admin/panel/reviews?status=PENDING",
      userId: null,
      adminId: null,
    });
  });

  dispatcher.on("ReviewApproved", async ({ review }) => {
    if (review.source !== "STEAM") return;
    await notificationUseCase.execute({
      title: "notifications.reviewThanks.title",
      content: JSON.stringify({ key: "notifications.reviewThanks.content", params: {} }),
      type: "SYSTEM",
      link: "/",
      userId: review.userId,
      adminId: null,
    });
  });

  dispatcher.on("ReviewRejected", async () => {
    // Intentionally quiet for users: rejection only unlocks a future submission.
  });

  return dispatcher;
}
