import { Router } from "express";
import { authMiddleware, adminOnly } from "../../../shared/infrastructure/middlewares/authMiddleware";
import { validate } from "../../../shared/infrastructure/middlewares/validationMiddleware";
import {
  AdminListReviewsUseCase,
  ApproveReviewUseCase,
  GetMyReviewStateUseCase,
  ListPublicReviewsUseCase,
  RejectReviewUseCase,
  SubmitReviewUseCase,
} from "../application/ReviewUseCases";
import { createReviewEventDispatcher } from "../application/ReviewEvents";
import { PrismaReviewRepository } from "./PrismaReviewRepository";
import { ReviewController } from "./ReviewController";
import {
  adminListReviewsSchema,
  createReviewSchema,
  listPublicReviewsSchema,
  reviewIdParamsSchema,
} from "./reviewSchemas";

const router = Router();

const reviewRepository = new PrismaReviewRepository();
const reviewEvents = createReviewEventDispatcher();
const reviewController = new ReviewController(
  new ListPublicReviewsUseCase(reviewRepository),
  new GetMyReviewStateUseCase(reviewRepository),
  new SubmitReviewUseCase(reviewRepository, reviewEvents),
  new AdminListReviewsUseCase(reviewRepository),
  new ApproveReviewUseCase(reviewRepository, reviewEvents),
  new RejectReviewUseCase(reviewRepository, reviewEvents),
);

router.get("/public", validate(listPublicReviewsSchema), (req, res) => reviewController.listPublic(req, res));
router.get("/me", authMiddleware, (req, res) => reviewController.getMe(req, res));
router.post("/", authMiddleware, validate(createReviewSchema), (req, res) => reviewController.submit(req, res));

router.get("/admin/all", authMiddleware, adminOnly, validate(adminListReviewsSchema), (req, res) =>
  reviewController.adminList(req, res),
);
router.patch("/admin/:id/approve", authMiddleware, adminOnly, validate(reviewIdParamsSchema), (req, res) =>
  reviewController.approve(req, res),
);
router.patch("/admin/:id/reject", authMiddleware, adminOnly, validate(reviewIdParamsSchema), (req, res) =>
  reviewController.reject(req, res),
);

export default router;
