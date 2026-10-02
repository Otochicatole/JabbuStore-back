import { Router } from "express";
import {
  authMiddleware,
  adminOnly,
  ticketUserAuth,
} from "../../../shared/infrastructure/middlewares/authMiddleware";
import { validate } from "../../../shared/infrastructure/middlewares/validationMiddleware";
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
import { ParticipationDrawController } from "./ParticipationDrawController";
import { PrismaParticipationDrawRepository } from "./PrismaParticipationDrawRepository";
import {
  createParticipationDrawSchema,
  drawIdParamsSchema,
  updateParticipationDrawSchema,
} from "./participationDrawSchemas";

const router = Router();

const repository = new PrismaParticipationDrawRepository();
const controller = new ParticipationDrawController(
  new ListPublicParticipationDrawsUseCase(repository),
  new ListAdminParticipationDrawsUseCase(repository),
  new GetParticipationDrawDetailsUseCase(repository),
  new GetMyEligibilityUseCase(repository),
  new CreateParticipationDrawUseCase(repository),
  new UpdateParticipationDrawUseCase(repository),
  new CancelParticipationDrawUseCase(repository),
  new DeleteParticipationDrawUseCase(repository),
  new DrawParticipationDrawUseCase(repository),
);

// Admin (before /:id routes)
router.get("/admin/all", authMiddleware, adminOnly, (req, res) =>
  controller.listAdmin(req, res),
);
router.get(
  "/admin/:id",
  authMiddleware,
  adminOnly,
  validate(drawIdParamsSchema),
  (req, res) => controller.getAdminDetails(req, res),
);
router.post(
  "/admin",
  authMiddleware,
  adminOnly,
  validate(createParticipationDrawSchema),
  (req, res) => controller.create(req, res),
);
router.patch(
  "/admin/:id",
  authMiddleware,
  adminOnly,
  validate(updateParticipationDrawSchema),
  (req, res) => controller.update(req, res),
);
router.patch(
  "/admin/:id/cancel",
  authMiddleware,
  adminOnly,
  validate(drawIdParamsSchema),
  (req, res) => controller.cancel(req, res),
);
router.delete(
  "/admin/:id",
  authMiddleware,
  adminOnly,
  validate(drawIdParamsSchema),
  (req, res) => controller.delete(req, res),
);
router.post(
  "/admin/:id/draw",
  authMiddleware,
  adminOnly,
  validate(drawIdParamsSchema),
  (req, res) => controller.draw(req, res),
);

// Public
router.get("/", (req, res) => controller.listPublic(req, res));
router.get(
  "/:id/me",
  ticketUserAuth,
  validate(drawIdParamsSchema),
  (req, res) => controller.getMyEligibility(req, res),
);
router.get(
  "/:id",
  validate(drawIdParamsSchema),
  (req, res) => controller.getPublicDetails(req, res),
);

export default router;
