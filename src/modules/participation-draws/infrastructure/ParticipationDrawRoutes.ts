import { Router } from "express";
import multer from "multer";
import {
  authMiddleware,
  adminOnly,
  ticketUserAuth,
} from "../../../shared/infrastructure/middlewares/authMiddleware";
import { validate } from "../../../shared/infrastructure/middlewares/validationMiddleware";
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
import { ParticipationDrawController } from "./ParticipationDrawController";
import { PrismaParticipationDrawRepository } from "./PrismaParticipationDrawRepository";
import {
  createParticipationDrawSchema,
  drawIdParamsSchema,
  manualDrawParticipationDrawSchema,
  updateParticipationDrawSchema,
} from "./participationDrawSchemas";

const router = Router();

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

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
  new AddFakeParticipantsToParticipationDrawUseCase(repository),
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
router.post(
  "/admin/:id/draw-manual",
  authMiddleware,
  adminOnly,
  validate(manualDrawParticipationDrawSchema),
  (req, res) => controller.draw(req, res),
);
router.post(
  "/admin/:id/fake-participants",
  authMiddleware,
  adminOnly,
  uploadAvatar.single("avatarFile"),
  (req, res) => controller.addFakeParticipants(req, res),
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
